import * as fs from 'fs';
import * as path from 'path';
import * as fse from 'fs-extra';
import pdfParse from 'pdf-parse';
import { PDFDocument } from 'pdf-lib';
import { promisify } from 'util';
import { spawn } from 'child_process';
import sharp from 'sharp';
import { convert } from 'libreoffice-convert';
import { 
  DocType, 
  SplitterInput, 
  SplitterResult, 
  SplitterConfig, 
  DEFAULT_SPLITTER_CONFIG 
} from './models/splitterTypes';
import { v4 as uuidv4 } from 'uuid';

// Promisify libreoffice-convert
const convertPromise = promisify(convert);

/**
 * Full Document Splitter class
 * Handles splitting documents into pages and extracting text
 * Equivalent to the Python splitter module with full functionality
 */
export class FullDocumentSplitter {
  private config: SplitterConfig;

  constructor(config: Partial<SplitterConfig> = {}) {
    this.config = { ...DEFAULT_SPLITTER_CONFIG, ...config };
  }

  /**
   * Main function to run the splitter
   * @param input SplitterInput containing file paths and output directories
   * @returns SplitterResult with paths to generated files
   */
  async runSplitter(input: SplitterInput): Promise<SplitterResult> {
    console.log(`\n---> Starting Document Splitting for ${path.basename(input.sourceFilePath)} <---`);

    try {
      // Create output directories if they don't exist
      fse.ensureDirSync(input.tempDir);
      fse.ensureDirSync(input.imageOutputDir);
      fse.ensureDirSync(input.textOutputDir);

      // Get file info and document type
      const fileExt = path.extname(input.sourceFilePath).toLowerCase();
      const fileName = path.basename(input.sourceFilePath);
      const baseFileName = path.basename(input.sourceFilePath, fileExt);
      const docType = this.getDocType(fileExt);

      if (docType === 'unsupported') {
        throw new Error(`Unsupported file type: ${fileExt}`);
      }

      // Initialize result arrays
      let pageTextPaths: string[] = [];
      let pageImagePaths: string[] = [];

      // Process based on document type
      switch(docType) {
        case 'pdf':
          pageTextPaths = await this.extractTextFromPdf(input.sourceFilePath, input.textOutputDir, baseFileName);
          pageImagePaths = await this.convertPdfToImages(input.sourceFilePath, input.imageOutputDir, baseFileName);
          break;

        case 'docx':
        case 'pptx':
          // 1. Convert to PDF first
          const pdfPath = await this.convertOfficeToPdf(
            input.sourceFilePath, 
            input.tempDir, 
            `${baseFileName}.pdf`
          );
          
          // 2. Process the PDF
          pageTextPaths = await this.extractTextFromPdf(pdfPath, input.textOutputDir, baseFileName);
          pageImagePaths = await this.convertPdfToImages(pdfPath, input.imageOutputDir, baseFileName);
          break;

        case 'image':
          // For images, there's no text to extract
          pageImagePaths = await this.processInputImage(input.sourceFilePath, input.imageOutputDir, baseFileName);
          break;
      }

      if (pageImagePaths.length === 0) {
        console.warn(`Warning: No images were generated for ${input.sourceFilePath}`);
      }

      if (pageTextPaths.length === 0 && docType !== 'image') {
        console.warn(`Warning: No text was extracted for ${input.sourceFilePath}`);
      }

      console.log(`---> Splitting finished. Generated ${pageImagePaths.length} images and ${pageTextPaths.length} text files <---`);

      return {
        pageTextPaths,
        pageImagePaths,
        docType,
        originalFilename: fileName,
        originalBaseFilename: baseFileName,
        status: pageImagePaths.length > 0 ? 'success' : 'failed'
      };
    } catch (error: any) {
      console.error(`Error in document splitting: ${error.message || error}`);
      
      // Get base filename even in case of error if possible
      const originalFilename = path.basename(input.sourceFilePath);
      const baseFileNameOnError = path.basename(originalFilename, path.extname(originalFilename));
      
      return {
        pageTextPaths: [],
        pageImagePaths: [],
        // Use a valid DocType or handle 'unsupported' case if needed
        docType: this.getDocType(path.extname(input.sourceFilePath)), 
        originalFilename: originalFilename,
        originalBaseFilename: baseFileNameOnError,
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
      const mode = Buffer.isBuffer(content) ? 'binary' : 'utf8';
      fse.ensureDirSync(path.dirname(outputPath));
      
      if (mode === 'binary') {
        await fse.writeFile(outputPath, content);
      } else {
        // For text content:
        // 1. Normalize line endings to \n (Unix style) to match Python behavior
        // 2. Ensure UTF-8 encoding
        const normalizedContent = (content as string).replace(/\r\n/g, '\n');
        
        await fse.writeFile(outputPath, normalizedContent, { encoding: 'utf8' });
        console.log(`Saved text file (${Buffer.byteLength(normalizedContent, 'utf8')} bytes): ${outputPath}`);
      }
      
      console.log(`Saved file: ${outputPath}`);
      return true;
    } catch (error: any) {
      console.error(`Error saving file ${outputPath}: ${error.message || error}`);
      return false;
    }
  }

  /**
   * Extract text from PDF using pdf-parse
   * Equivalent to Python's PyMuPDF functionality
   * @param pdfPath Path to the PDF file
   * @param textOutputDir Directory to save extracted text
   * @param baseFilename Base filename for output files
   * @returns Array of paths to saved text files
   */
  private async extractTextFromPdf(pdfPath: string, textOutputDir: string, baseFilename: string): Promise<string[]> {
    console.log(`Extracting text from PDF: ${pdfPath}`);
    const pageTextPaths: string[] = [];

    try {
      // Read PDF file
      const dataBuffer = await fse.readFile(pdfPath);
      
      // Load PDF document with pdf-lib for page count
      const pdfDoc = await PDFDocument.load(dataBuffer);
      const pageCount = pdfDoc.getPageCount();
      
      // Parse PDF data with pdf-parse for text extraction
      const pdfData = await pdfParse(dataBuffer);
      
      // If we just have one page, save the text directly
      if (pageCount === 1) {
        const textOutputPath = path.join(textOutputDir, `${baseFilename}_page_1.txt`);
        await this.saveContentToFile(pdfData.text, textOutputPath);
        pageTextPaths.push(textOutputPath);
        return pageTextPaths;
      }
      
      // For multi-page PDFs, we need to create single-page PDFs and extract text from each
      for (let pageNum = 0; pageNum < pageCount; pageNum++) {
        try {
          // Create a new PDF with just this page
          const singlePagePdf = await PDFDocument.create();
          const [copiedPage] = await singlePagePdf.copyPages(pdfDoc, [pageNum]);
          singlePagePdf.addPage(copiedPage);
          const pdfBytes = await singlePagePdf.save();
          
          // Extract text from this single page PDF
          const pageData = await pdfParse(Buffer.from(pdfBytes));
          
          // Save to file
          const textOutputPath = path.join(textOutputDir, `${baseFilename}_page_${pageNum + 1}.txt`);
          await this.saveContentToFile(pageData.text, textOutputPath);
          pageTextPaths.push(textOutputPath);
        } catch (error: any) {
          console.error(`Error extracting text from page ${pageNum + 1}: ${error.message || error}`);
        }
      }
      
      return pageTextPaths;
    } catch (error: any) {
      console.error(`Error extracting text from PDF: ${error.message || error}`);
      return pageTextPaths;
    }
  }

  /**
   * Convert PDF to images
   * @param pdfPath Path to the PDF file
   * @param imageOutputDir Directory to save generated images
   * @param baseFilename Base filename for output files
   * @returns Array of paths to saved images
   */
  private async convertPdfToImages(pdfPath: string, imageOutputDir: string, baseFilename: string): Promise<string[]> {
    console.log(`Converting PDF to images: ${pdfPath}`);
    const imagePaths: string[] = [];

    try {
      // Check if we have poppler-utils (pdftoppm) available
      if (await this.isPopplerAvailable()) {
        try {
          const popperPaths = await this.convertPdfWithPoppler(pdfPath, imageOutputDir, baseFilename);
          if (popperPaths.length > 0) {
            return popperPaths;
          }
        } catch (error: any) {
          console.error(`Poppler conversion failed: ${error.message || error}`);
        }
      }
      
      // Try ghostscript if poppler failed
      if (await this.isGhostscriptAvailable()) {
        try {
          const gsPaths = await this.convertPdfWithGhostscript(pdfPath, imageOutputDir, baseFilename);
          if (gsPaths.length > 0) {
            return gsPaths;
          }
        } catch (error: any) {
          console.error(`Ghostscript conversion failed: ${error.message || error}`);
        }
      }
      
      // If we get here, all methods have failed
      console.error('Failed to convert PDF to images using any available method');
      return imagePaths;
    } catch (error: any) {
      console.error(`Error converting PDF to images: ${error.message || error}`);
      return imagePaths;
    }
  }

  /**
   * Check if poppler-utils (pdftoppm) is available
   * @returns Promise resolving to true if available
   */
  private async isPopplerAvailable(): Promise<boolean> {
    try {
      const process = spawn('pdftoppm', ['-v']);
      return new Promise((resolve) => {
        process.on('error', () => resolve(false));
        process.on('close', (code) => resolve(code === 0));
        
        // Timeout after 1 second
        setTimeout(() => resolve(false), 1000);
      });
    } catch (error) {
      return false;
    }
  }

  /**
   * Check if ghostscript (gs) is available
   * @returns Promise resolving to true if available
   */
  private async isGhostscriptAvailable(): Promise<boolean> {
    try {
      const process = spawn('gs', ['--version']);
      return new Promise((resolve) => {
        process.on('error', () => resolve(false));
        process.on('close', (code) => resolve(code === 0));
        
        // Timeout after 1 second
        setTimeout(() => resolve(false), 1000);
      });
    } catch (error) {
      return false;
    }
  }

  /**
   * Convert PDF to images using poppler-utils (pdftoppm)
   * @param pdfPath Path to the PDF file
   * @param imageOutputDir Directory to save generated images
   * @param baseFilename Base filename for output files
   * @returns Array of paths to saved images
   */
  private async convertPdfWithPoppler(
    pdfPath: string, 
    imageOutputDir: string, 
    baseFilename: string
  ): Promise<string[]> {
    const imagePaths: string[] = [];
    
    return new Promise((resolve, reject) => {
      try {
        const outputPrefix = path.join(imageOutputDir, baseFilename);
        
        // Use pdftoppm to convert PDF to PNG images
        const process = spawn('pdftoppm', [
          '-png',            // Output format
          '-r', '300',       // Resolution (DPI)
          pdfPath,           // Input file
          outputPrefix       // Output filename prefix
        ]);
        
        let errorOutput = '';
        
        process.stderr.on('data', (data) => {
          errorOutput += data.toString();
        });
        
        process.on('close', async (code) => {
          if (code !== 0) {
            reject(new Error(`pdftoppm failed with code ${code}: ${errorOutput}`));
            return;
          }
          
          // pdftoppm creates files with naming pattern: prefix-01.png, prefix-02.png, etc.
          // We need to find these files and rename them to match our naming convention
          const files = await fse.readdir(imageOutputDir);
          for (const file of files) {
            if (file.startsWith(baseFilename) && file.endsWith('.png')) {
              // Extract the page number from pdftoppm output
              const match = file.match(/-(\d+)\.png$/);
              if (match) {
                const pageNum = parseInt(match[1], 10);
                const newName = `${baseFilename}_page_${pageNum}.png`;
                const oldPath = path.join(imageOutputDir, file);
                const newPath = path.join(imageOutputDir, newName);
                
                // Rename file
                await fse.rename(oldPath, newPath);
                imagePaths.push(newPath);
              }
            }
          }
          
          // Sort image paths by page number
          imagePaths.sort((a, b) => {
            const aMatch = a.match(/_page_(\d+)\.png$/);
            const bMatch = b.match(/_page_(\d+)\.png$/);
            if (aMatch && bMatch) {
              return parseInt(aMatch[1], 10) - parseInt(bMatch[1], 10);
            }
            return 0;
          });
          
          resolve(imagePaths);
        });
        
        process.on('error', (error) => {
          reject(error);
        });
      } catch (error: any) {
        reject(error);
      }
    });
  }

  /**
   * Convert PDF to images using ghostscript
   * @param pdfPath Path to the PDF file
   * @param imageOutputDir Directory to save generated images
   * @param baseFilename Base filename for output files
   * @returns Array of paths to saved images
   */
  private async convertPdfWithGhostscript(
    pdfPath: string, 
    imageOutputDir: string, 
    baseFilename: string
  ): Promise<string[]> {
    // The GS command produces files with names like "basename_page_1.png"
    const outputPattern = path.join(imageOutputDir, `${baseFilename}_page_%d.png`);
    
    return new Promise((resolve, reject) => {
      try {
        // Use ghostscript to convert PDF to PNG images
        const process = spawn('gs', [
          '-dBATCH',
          '-dNOPAUSE',
          '-sDEVICE=png16m',
          '-r300',
          '-dTextAlphaBits=4',
          '-dGraphicsAlphaBits=4',
          `-sOutputFile=${outputPattern}`,
          pdfPath
        ]);
        
        let errorOutput = '';
        
        process.stderr.on('data', (data) => {
          errorOutput += data.toString();
        });
        
        process.on('close', async (code) => {
          if (code !== 0) {
            reject(new Error(`ghostscript failed with code ${code}: ${errorOutput}`));
            return;
          }
          
          // Find the generated images
          const imagePaths: string[] = [];
          const files = await fse.readdir(imageOutputDir);
          
          for (const file of files) {
            if (file.startsWith(`${baseFilename}_page_`) && file.endsWith('.png')) {
              imagePaths.push(path.join(imageOutputDir, file));
            }
          }
          
          // Sort image paths by page number
          imagePaths.sort((a, b) => {
            const aMatch = a.match(/_page_(\d+)\.png$/);
            const bMatch = b.match(/_page_(\d+)\.png$/);
            if (aMatch && bMatch) {
              return parseInt(aMatch[1], 10) - parseInt(bMatch[1], 10);
            }
            return 0;
          });
          
          resolve(imagePaths);
        });
        
        process.on('error', (error) => {
          reject(error);
        });
      } catch (error: any) {
        reject(error);
      }
    });
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
      
      // Process image with sharp
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
      console.error(`Error processing image: ${error.message || error}`);
      return [];
    }
  }

  /**
   * Convert Office document to PDF using LibreOffice
   * @param officePath Path to the Office document
   * @param outputDir Directory to save converted PDF
   * @param outputFilename Filename for the output PDF
   * @returns Path to the generated PDF
   */
  private async convertOfficeToPdf(
    officePath: string, 
    outputDir: string, 
    outputFilename: string
  ): Promise<string> {
    try {
      console.log(`Converting Office document to PDF: ${officePath}`);
      
      // Ensure the output directory exists
      fse.ensureDirSync(outputDir);
      
      // Output path
      const outputPath = path.join(outputDir, outputFilename);
      
      // Read the office document
      const inputBuffer = await fse.readFile(officePath);
      
      // Convert to PDF
      if (!convertPromise) {
        throw new Error('libreoffice-convert is not available');
      }
      
      const outputBuffer = await convertPromise(inputBuffer, '.pdf', undefined);
      
      // Write the PDF to disk
      await fse.writeFile(outputPath, outputBuffer);
      
      return outputPath;
    } catch (error: any) {
      console.error(`Error converting Office document to PDF: ${error.message || error}`);
      throw error;
    }
  }
  
  /**
   * Check if LibreOffice is installed
   * @returns Promise resolving to true if LibreOffice is installed
   */
  private async isLibreOfficeInstalled(): Promise<boolean> {
    return new Promise((resolve) => {
      const process = spawn('libreoffice', ['--version']);
      
      process.on('error', () => resolve(false));
      process.on('close', (code) => resolve(code === 0));
      
      // Timeout after 1 second
      setTimeout(() => resolve(false), 1000);
    });
  }
} 