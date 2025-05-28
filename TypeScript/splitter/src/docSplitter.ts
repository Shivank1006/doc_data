import * as fs from 'fs';
import * as path from 'path';
import * as fse from 'fs-extra';
import sharp from 'sharp';
import { execSync } from 'child_process';
import { promisify } from 'util';
import { v4 as uuidv4 } from 'uuid';
import {
  DocType,
  SplitterInput,
  SplitterResult,
  SplitterConfig,
  DEFAULT_SPLITTER_CONFIG
} from './models/splitterTypes';
import logger from './utils/logger';

// Import AWS SDK v2 for S3
import * as AWS from 'aws-sdk';

// Import PDF processing libraries
import { PDFDocument } from 'pdf-lib';
import pdfParse from 'pdf-parse';
import { pdfToPng } from 'pdf-to-png-converter';

// Import libreoffice-convert with promisify for async usage, but make it optional
let libre: any;
let libreConvert: any;
try {
  libre = require('libreoffice-convert');
  libreConvert = promisify(libre.convert);
} catch (error) {
  console.warn('libreoffice-convert not available - Office document processing will not work');
  libre = null;
  libreConvert = null;
}

const execAsync = promisify(execSync);

/**
 * DocumentSplitter class
 * Handles splitting documents into pages and extracting text
 * Pure TypeScript implementation with no Python dependencies
 */
export class DocumentSplitter {
  private config: SplitterConfig;
  private s3Client: any = null;

  constructor(config: Partial<SplitterConfig> = {}) {
    this.config = { ...DEFAULT_SPLITTER_CONFIG, ...config };

    // Initialize S3 client if we're in AWS environment
    if (process.env.AWS_LAMBDA_FUNCTION_NAME && process.env.S3_BUCKET_NAME) {
      this.s3Client = new AWS.S3();
    }
  }

  /**
   * Main function to run the splitter
   * @param input SplitterInput containing file paths and output directories
   * @returns SplitterResult with paths to generated files
   */
  async runSplitter(input: SplitterInput): Promise<SplitterResult> {
    const { sourceFilePath, tempDir, imageOutputDir, textOutputDir, outputFormat } = input;
    logger.info(`\n---> Starting Document Splitting for ${path.basename(sourceFilePath)} <---`); // Use logger

    try {
      // Create output directories if they don't exist
      fse.ensureDirSync(tempDir);
      fse.ensureDirSync(imageOutputDir);
      fse.ensureDirSync(textOutputDir);

      // Get file info and document type
      const fileExt = path.extname(sourceFilePath).toLowerCase();
      const fileName = path.basename(sourceFilePath);
      const baseFileName = path.basename(sourceFilePath, fileExt);
      const docType = this.getDocType(fileExt);

      if (docType === 'unsupported') {
        throw new Error(`Unsupported file type: ${fileExt}`);
      }

      // Initialize result arrays
      let pageTextPaths: string[] = [];
      let pageImagePaths: string[] = [];

      // Process based on document type
      if (docType === 'pdf') {
        // Extract text from PDF
        logger.info(`Extracting text from PDF: ${sourceFilePath}`); // Use logger
        pageTextPaths = await this.extractTextFromPdf(sourceFilePath, textOutputDir, baseFileName);

        // Convert PDF to images
        logger.info(`Converting PDF to images: ${sourceFilePath}`); // Use logger
        pageImagePaths = await this.convertPdfToImages(sourceFilePath, imageOutputDir, baseFileName);
      } else if (docType === 'docx' || docType === 'pptx') {
        // For Office documents, convert to PDF first, then process
        const pdfPath = await this.convertOfficeToPdf(sourceFilePath, tempDir);

        // Extract text based on document type
        if (docType === 'docx') {
          pageTextPaths = await this.extractTextFromOfficeDocument(
            sourceFilePath,
            textOutputDir,
            baseFileName,
            'docx'
          );
        } else {
          pageTextPaths = await this.extractTextFromOfficeDocument(
            sourceFilePath,
            textOutputDir,
            baseFileName,
            'pptx'
          );
        }

        // Convert PDF to images
        pageImagePaths = await this.convertPdfToImages(
          pdfPath,
          imageOutputDir,
          baseFileName
        );
      } else if (docType === 'image') {
        // For images, there's no text to extract
        pageImagePaths = await this.processInputImage(
          sourceFilePath,
          imageOutputDir,
          baseFileName
        );
      }

      // Upload to S3 if in AWS environment and S3 client is initialized
      if (this.s3Client && process.env.S3_BUCKET_NAME) {
        const bucketName = process.env.S3_BUCKET_NAME;
        const imagesPrefix = process.env.INTERMEDIATE_IMAGES_PREFIX || 'intermediate-images';
        const textPrefix = process.env.INTERMEDIATE_RAW_TEXT_PREFIX || 'intermediate-raw-text';

        const s3ImagePaths = await this.uploadFilesToS3(pageImagePaths, bucketName, imagesPrefix);
        const s3TextPaths = await this.uploadFilesToS3(pageTextPaths, bucketName, textPrefix);

        logger.info(`Uploaded ${s3ImagePaths.length} images and ${s3TextPaths.length} text files to S3`);

        return {
          pageTextPaths: s3TextPaths,
          pageImagePaths: s3ImagePaths,
          docType,
          originalFilename: fileName,
          originalBaseFilename: path.basename(fileName, path.extname(fileName)),
          status: s3ImagePaths.length > 0 ? 'success' : 'failed'
        };
      }

      // If NOT uploading to S3, return local paths
      logger.info(`---> Splitting finished. Generated ${pageImagePaths.length} images and ${pageTextPaths.length} text files <---`);

      return {
        pageTextPaths,
        pageImagePaths,
        docType,
        originalFilename: fileName,
        originalBaseFilename: path.basename(fileName, path.extname(fileName)),
        status: pageImagePaths.length > 0 ? 'success' : 'failed'
      };
    } catch (error: any) {
      logger.error({ err: error }, `Error in document splitting for ${sourceFilePath}`);
      return {
        pageTextPaths: [],
        pageImagePaths: [],
        docType: 'unsupported',
        originalFilename: path.basename(sourceFilePath),
        originalBaseFilename: path.basename(sourceFilePath, path.extname(sourceFilePath)),
        status: 'failed',
        error: `Error during document splitting: ${error.message || error}`
      };
    }
  }

  /**
   * Determine document type from file extension
   * @param fileExtension File extension with dot (e.g., '.pdf')
   * @returns DocType enum value
   */
  private getDocType(fileExtension: string): DocType {
    switch (fileExtension.toLowerCase()) {
      case '.pdf':
        return 'pdf';
      case '.docx':
      case '.doc':
        return 'docx';
      case '.pptx':
      case '.ppt':
        return 'pptx';
      case '.jpg':
      case '.jpeg':
      case '.png':
      case '.bmp':
      case '.tiff':
      case '.gif':
        return 'image';
      default:
        return 'unsupported';
    }
  }

  /**
   * Save content to a file
   * @param content Content to save
   * @param outputPath Path to save the content to
   * @returns Boolean indicating success
   */
  private async saveContentToFile(content: string | Buffer, outputPath: string): Promise<boolean> {
    try {
      // Ensure the directory exists
      const dir = path.dirname(outputPath);
      fse.ensureDirSync(dir);

      // Save content to file
      fs.writeFileSync(outputPath, content);
      return true;
    } catch (error: any) {
      logger.error({ err: error, path: outputPath }, 'Error saving content to file');
      return false;
    }
  }

  /**
   * Extract text from PDF using pdf-parse
   * @param pdfPath Path to the PDF file
   * @param textOutputDir Directory to save extracted text
   * @param baseFilename Base filename for output files
   * @returns Array of paths to saved text files
   */
  private async extractTextFromPdf(pdfPath: string, textOutputDir: string, baseFilename: string): Promise<string[]> {
    const pageTextPaths: string[] = [];
    try {
      // Read PDF file
      const dataBuffer = fs.readFileSync(pdfPath);

      // Parse PDF text using pdf-parse (whole document text extraction)
      const pdfData = await pdfParse(dataBuffer);

      // Load PDF document with pdf-lib for page-level operations
      const pdfDoc = await PDFDocument.load(dataBuffer);
      const pageCount = pdfDoc.getPageCount();

      logger.info(`PDF has ${pageCount} pages. Extracting text...`);

      // If we just have one page PDF, save the single text output
      if (pageCount === 1) {
        const textOutputPath = path.join(textOutputDir, `${baseFilename}_page_1.txt`);
        await this.saveContentToFile(pdfData.text, textOutputPath);
        pageTextPaths.push(textOutputPath);
      } else {
        // For multi-page PDFs, create single-page PDFs and extract text page by page
        // This gives us better per-page text organization than just splitting the text
        for (let pageNum = 0; pageNum < pageCount; pageNum++) {
          try {
            // Create a new PDF with just this page
            const singlePagePdf = await PDFDocument.create();
            const [copiedPage] = await singlePagePdf.copyPages(pdfDoc, [pageNum]);
            singlePagePdf.addPage(copiedPage);
            const pdfBytes = await singlePagePdf.save();

            // Extract text from this single page
            const pageData = await pdfParse(Buffer.from(pdfBytes));
            const pageText = pageData.text;

            // Save to file
            const textOutputPath = path.join(textOutputDir, `${baseFilename}_page_${pageNum + 1}.txt`);
            await this.saveContentToFile(pageText, textOutputPath);
            pageTextPaths.push(textOutputPath);
          } catch (error: any) {
            logger.error({ err: error, page: pageNum + 1 }, `Error extracting text from page ${pageNum + 1}`);
          }
        }
      }
    } catch (error: any) {
      logger.error({ err: error }, `Error extracting text from PDF: ${pdfPath}`);
    }

    return pageTextPaths;
  }

  /**
   * Check if LibreOffice is available on the system
   * @returns True if LibreOffice is available
   */
  private isLibreOfficeAvailable(): boolean {
    try {
      // Test if libreoffice binary is available
      if (!libre || !libreConvert) {
        return false;
      }
      execSync('libreoffice --help', { stdio: 'ignore' });
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Convert PDF to images using pdf-to-png-converter
   * @param pdfPath Path to the PDF file
   * @param imageOutputDir Directory to save generated images
   * @param baseFilename Base filename for output files
   * @returns Array of paths to saved images
   */
  private async convertPdfToImages(pdfPath: string, imageOutputDir: string, baseFilename: string): Promise<string[]> {
    try {
      logger.info(`Converting PDF to images: ${pdfPath}`);

      // Try the pdf-to-png-converter package first
      try {
        const imagePaths = await this.convertPdfToPngWithConverter(pdfPath, imageOutputDir, baseFilename);
        if (imagePaths.length > 0) {
          return imagePaths;
        }
      } catch (error: any) {
        logger.error({ err: error }, 'pdf-to-png-converter failed, will try alternative methods');
      }

      // Try LibreOffice as another option
      if (this.isLibreOfficeAvailable()) {
        try {
          const imagePaths = await this.convertPdfToImagesWithLibreOffice(pdfPath, imageOutputDir, baseFilename);
          if (imagePaths.length > 0) {
            return imagePaths;
          }
        } catch (error: any) {
          logger.error({ err: error }, 'LibreOffice conversion failed, will try fallback methods');
        }
      }

      // If all else fails, create placeholder images with text indicating the page number
      logger.warn('All PDF-to-image conversion methods failed. Creating placeholder images.');
      return await this.createPlaceholderImages(pdfPath, imageOutputDir, baseFilename);

    } catch (error: any) {
      logger.error({ err: error }, `Error converting PDF to images: ${pdfPath}`);
      return [];
    }
  }

  /**
   * Convert PDF to PNG using the pdf-to-png-converter package
   * @param pdfPath Path to the PDF file
   * @param imageOutputDir Directory to save generated images
   * @param baseFilename Base filename for output files
   * @returns Array of paths to saved images
   */
  private async convertPdfToPngWithConverter(pdfPath: string, imageOutputDir: string, baseFilename: string): Promise<string[]> {
    const imagePaths: string[] = [];

    try {
      // Use pdf-to-png-converter
      const pngPages = await pdfToPng(pdfPath, {
        outputFolder: imageOutputDir,
        outputFileMaskFunc: (pageNumber: number) => `${baseFilename}_page_${pageNumber}.png`,
      });

      // Add generated file paths to result array
      for (const page of pngPages) {
        imagePaths.push(page.path);
      }

      return imagePaths;
    } catch (error: any) {
      logger.error({ err: error }, 'Error in pdf-to-png-converter');
      throw error;
    }
  }

  /**
   * Convert Office documents to PDF using LibreOffice
   * @param officePath Path to the Office document
   * @param tempDir Directory to save temporary files
   * @returns Path to the generated PDF
   */
  private async convertOfficeToPdf(officePath: string, tempDir: string): Promise<string> {
    if (!this.isLibreOfficeAvailable()) {
      throw new Error('LibreOffice is not available for converting Office documents to PDF');
    }

    try {
      const ext = path.extname(officePath);
      const baseName = path.basename(officePath, ext);
      const pdfPath = path.join(tempDir, `${baseName}.pdf`);

      logger.info(`Converting Office document to PDF: ${officePath} -> ${pdfPath}`);

      // Read Office document
      const document = fs.readFileSync(officePath);

      // Convert to PDF
      const pdfBuffer = await libreConvert(document, '.pdf', '');

      // Save PDF
      fs.writeFileSync(pdfPath, pdfBuffer);

      logger.info('Office document converted to PDF successfully.');

      return pdfPath;
    } catch (error: any) {
      logger.error({ err: error }, `Error converting Office document to PDF: ${officePath}`);
      throw error;
    }
  }

  /**
   * Extract text from Office document
   * @param documentPath Path to the Office document
   * @param textOutputDir Directory to save extracted text
   * @param baseFilename Base filename for output files
   * @param docType Type of the document (docx or pptx)
   * @returns Array of paths to saved text files
   */
  private async extractTextFromOfficeDocument(
    documentPath: string,
    textOutputDir: string,
    baseFilename: string,
    docType: 'docx' | 'pptx'
  ): Promise<string[]> {
    try {
      logger.info(`Extracting text from ${docType.toUpperCase()}: ${documentPath}`);

      // Convert document to PDF
      const pdfPath = await this.convertOfficeToPdf(documentPath, textOutputDir);

      // Extract text based on document type
      if (docType === 'docx') {
        return await this.extractTextFromDocx(documentPath, textOutputDir, baseFilename, pdfPath);
      } else {
        return await this.extractTextFromPptx(documentPath, textOutputDir, baseFilename, pdfPath);
      }
    } catch (error: any) {
      logger.error({ err: error }, `Error extracting text from ${docType}: ${documentPath}`);
      return [];
    }
  }

  /**
   * Extract text from DOCX document (via PDF conversion)
   * @param docxPath Path to the DOCX document
   * @param textOutputDir Directory to save extracted text
   * @param baseFilename Base filename for output files
   * @param pdfPath Path to the converted PDF
   * @returns Array of paths to saved text files
   */
  private async extractTextFromDocx(
    docxPath: string,
    textOutputDir: string,
    baseFilename: string,
    pdfPath: string
  ): Promise<string[]> {
    // For DOCX documents, we use the PDF extraction since we already converted to PDF
    try {
      return await this.extractTextFromPdf(pdfPath, textOutputDir, baseFilename);
    } catch (error: any) {
      logger.error({ err: error }, `Error extracting text from DOCX via PDF: ${docxPath}`);

      // If PDF extraction fails, we could implement a direct DOCX parser here
      // For now, we'll return an empty array
      return [];
    }
  }

  /**
   * Extract text from PPTX document (via PDF conversion)
   * @param pptxPath Path to the PPTX document
   * @param textOutputDir Directory to save extracted text
   * @param baseFilename Base filename for output files
   * @param pdfPath Path to the converted PDF
   * @returns Array of paths to saved text files
   */
  private async extractTextFromPptx(
    pptxPath: string,
    textOutputDir: string,
    baseFilename: string,
    pdfPath: string
  ): Promise<string[]> {
    // For PPTX documents, we use the PDF extraction since we already converted to PDF
    try {
      return await this.extractTextFromPdf(pdfPath, textOutputDir, baseFilename);
    } catch (error: any) {
      logger.error({ err: error }, `Error extracting text from PPTX via PDF: ${pptxPath}`);

      // If PDF extraction fails, we could implement a direct PPTX parser here
      // For now, we'll return an empty array
      return [];
    }
  }

  /**
   * Process a single input image
   * @param imagePath Path to the input image
   * @param imageOutputDir Directory to save processed image
   * @param baseFilename Base filename for output files
   * @returns Array with path to processed image
   */
  private async processInputImage(imagePath: string, imageOutputDir: string, baseFilename: string): Promise<string[]> {
    try {
      // For a single image, we just process it and save as a page
      const outputImagePath = path.join(imageOutputDir, `${baseFilename}_page_1.png`);

      // Create output directory if it doesn't exist
      fse.ensureDirSync(imageOutputDir);

      // Process image and save
      await sharp(imagePath)
        .resize({
          width: this.config.maxPageSize,
          height: this.config.maxPageSize,
          fit: 'inside',
          withoutEnlargement: true
        })
        .png()
        .toFile(outputImagePath);

      return [outputImagePath];
    } catch (error: any) {
      logger.error({ err: error }, `Error processing image: ${imagePath}`);
      return [];
    }
  }

  /**
   * Upload files to S3
   * @param localPaths Array of local file paths
   * @param bucketName S3 bucket name
   * @param s3Prefix S3 prefix
   * @returns Array of S3 URIs
   */
  private async uploadFilesToS3(localPaths: string[], bucketName: string, s3Prefix: string): Promise<string[]> {
    if (!this.s3Client) {
      return [];
    }

    const s3Uris: string[] = [];
    const runUuid = uuidv4(); // Generate a new UUID for this set of uploads

    for (const localPath of localPaths) {
      try {
        const fileName = path.basename(localPath);
        // Ensure the s3Prefix ends with a slash
        const prefixWithSlash = s3Prefix.endsWith('/') ? s3Prefix : `${s3Prefix}/`;
        const s3Key = `${prefixWithSlash}${runUuid}/${fileName}`;

        const fileStream = fs.createReadStream(localPath);
        const contentType = localPath.endsWith('.png') ? 'image/png' :
                           localPath.endsWith('.jpg') || localPath.endsWith('.jpeg') ? 'image/jpeg' :
                           localPath.endsWith('.txt') ? 'text/plain' :
                           'application/octet-stream';

        const params = {
          Bucket: bucketName,
          Key: s3Key,
          Body: fileStream,
          ContentType: contentType
        };

        await this.s3Client.upload(params).promise();

        const s3Uri = `s3://${bucketName}/${s3Key}`;
        s3Uris.push(s3Uri);
        logger.info(`Uploaded to S3: ${localPath} -> ${s3Uri}`);
      } catch (error: any) {
        logger.error({ err: error, path: localPath }, 'Error uploading file to S3');
      }
    }

    return s3Uris;
  }

  /**
   * Convert PDF to images using LibreOffice
   * @param pdfPath Path to the PDF file
   * @param imageOutputDir Directory to save generated images
   * @param baseFilename Base filename for output files
   * @returns Array of paths to saved images
   */
  private async convertPdfToImagesWithLibreOffice(pdfPath: string, imageOutputDir: string, baseFilename: string): Promise<string[]> {
    if (!this.isLibreOfficeAvailable()) {
      throw new Error('LibreOffice is not available for converting PDF to images');
    }

    try {
      logger.info(`Converting PDF to images with LibreOffice: ${pdfPath}`);

      // Create temporary directories
      const pdfDir = path.dirname(pdfPath);
      const tempImagesDir = path.join(pdfDir, 'temp_images');
      fse.ensureDirSync(tempImagesDir);

      // Run LibreOffice command to convert PDF to PNG
      // We use the --convert-to "png" command with a headless LibreOffice
      const libreCmd = `libreoffice --headless --convert-to png --outdir "${tempImagesDir}" "${pdfPath}"`;

      try {
        execSync(libreCmd, { stdio: 'pipe' });
      } catch (error: any) {
        logger.error({ err: error }, `LibreOffice command failed: ${libreCmd}`);
        throw error;
      }

      // Now read the generated PNG files and rename them
      const imagePaths: string[] = [];
      const pdfBasename = path.basename(pdfPath, '.pdf');

      // LibreOffice generates filenames like "filename.pdf.png" for each page
      const generatedImagePath = path.join(tempImagesDir, `${pdfBasename}.pdf.png`);

      if (fs.existsSync(generatedImagePath)) {
        // If there's only one page
        const outputImagePath = path.join(imageOutputDir, `${baseFilename}_page_1.png`);
        fse.copySync(generatedImagePath, outputImagePath);
        imagePaths.push(outputImagePath);
      } else {
        // Check for numbered images (for multi-page PDFs):
        // LibreOffice might generate filename.pdf1.png, filename.pdf2.png, etc.
        let pageNum = 1;
        while (true) {
          const pageImagePath = path.join(tempImagesDir, `${pdfBasename}.pdf${pageNum}.png`);

          if (!fs.existsSync(pageImagePath)) {
            // No more pages found
            break;
          }

          // Copy and rename the page image
          const outputImagePath = path.join(imageOutputDir, `${baseFilename}_page_${pageNum}.png`);
          fse.copySync(pageImagePath, outputImagePath);
          imagePaths.push(outputImagePath);

          pageNum++;

          // Safety limit
          if (pageNum > this.config.maxImagesPerPDF) {
            logger.warn(`Reached maximum number of pages (${this.config.maxImagesPerPDF}) for PDF: ${pdfPath}`);
            break;
          }
        }
      }

      // Clean up temporary files
      try {
        fse.removeSync(tempImagesDir);
      } catch (error: any) {
        logger.warn({ err: error }, `Failed to clean up temporary image directory: ${tempImagesDir}`);
      }

      if (imagePaths.length === 0) {
        throw new Error('LibreOffice did not generate any image files');
      }

      return imagePaths;
    } catch (error: any) {
      logger.error({ err: error }, `Error converting PDF to images with LibreOffice: ${pdfPath}`);
      throw error;
    }
  }

  /**
   * Create placeholder images for PDF pages
   * @param pdfPath Path to the PDF file
   * @param imageOutputDir Directory to save generated images
   * @param baseFilename Base filename for output files
   * @returns Array of paths to saved images
   */
  private async createPlaceholderImages(pdfPath: string, imageOutputDir: string, baseFilename: string): Promise<string[]> {
    const imagePaths: string[] = [];

    try {
      // Read PDF file
      const dataBuffer = fs.readFileSync(pdfPath);

      // Load PDF document with pdf-lib
      const pdfDoc = await PDFDocument.load(dataBuffer);
      const pageCount = pdfDoc.getPageCount();

      logger.info(`Creating ${pageCount} placeholder images for PDF: ${pdfPath}`);

      // Create placeholder images
      for (let pageNum = 0; pageNum < pageCount; pageNum++) {
        try {
          const outputImagePath = path.join(imageOutputDir, `${baseFilename}_page_${pageNum + 1}.png`);

          // Get page dimensions from PDF
          const page = pdfDoc.getPage(pageNum);
          const { width, height } = page.getSize();

          // Calculate aspect ratio and determine image dimensions
          const aspectRatio = width / height;
          const imgWidth = 800;
          const imgHeight = Math.round(imgWidth / aspectRatio);

          // Create a simplified canvas context for text rendering
          const ctx = new CanvasRenderingContext(imgWidth, imgHeight);

          // Use Sharp to create a blank image with the page number
          await sharp({
            create: {
              width: imgWidth,
              height: imgHeight,
              channels: 4,
              background: { r: 255, g: 255, b: 255, alpha: 1 }
            }
          })
          .composite([
            {
              input: {
                text: {
                  text: `Page ${pageNum + 1} of ${pageCount}`,
                  font: 'sans',
                  rgba: true
                }
              },
              gravity: 'center'
            }
          ])
          .png()
          .toFile(outputImagePath);

          imagePaths.push(outputImagePath);
        } catch (error: any) {
          logger.error({ err: error, page: pageNum + 1 }, `Error creating placeholder image for page ${pageNum + 1}`);
        }
      }
    } catch (error: any) {
      logger.error({ err: error }, `Error creating placeholder images for PDF: ${pdfPath}`);
    }

    return imagePaths;
  }
}

// Simple mock class for canvas rendering context
// This is just for type compatibility and isn't used for actual rendering
class CanvasRenderingContext {
  width: number;
  height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  beginPath() {}
  moveTo() {}
  lineTo() {}
  stroke() {}
  fill() {}
  closePath() {}
  save() {}
  restore() {}
  scale() {}
  rotate() {}
  translate() {}
  transform() {}
  drawImage() {}
  rect() {}
  clip() {}
  createLinearGradient() { return { addColorStop: () => {} }; }
  createRadialGradient() { return { addColorStop: () => {} }; }
  fillText() {}
  measureText() { return { width: 0 }; }
  setTransform() {}
}






