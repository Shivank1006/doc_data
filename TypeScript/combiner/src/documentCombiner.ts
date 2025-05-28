import * as fs from 'fs';
import * as path from 'path';
import logger from './utils/logger';
import { v4 as uuidv4 } from 'uuid';
import {
  CombinerInput,
  CombinerResult,
  PageEntry,
  PageLoadError,
  AggregatedJsonData,
  PageProcessorResult,
  ImageDescription
} from './models/types';

// Get S3 bucket name from environment variables
const S3_BUCKET_NAME = process.env.S3_BUCKET_NAME || 'doc-proc-ts-maverick-tests';

/**
 * Helper function to determine the main output format when multiple are present
 * @param formats Set of encountered formats in page results
 * @returns The main output format to use
 */
function getMainOutputFormat(formats: Set<string>): string {
  // Prefer JSON if available
  if (formats.has('json')) {
    return 'json';
  }
  // Otherwise use the first format found
  const formatsArray = Array.from(formats);
  return formatsArray.length > 0 ? formatsArray[0] : 'json';
}

/**
 * Document Combiner
 * Combines individual page processor results into a single aggregated output
 */
export class DocumentCombiner {
  /**
   * Run the combiner to aggregate page processor results
   * @param input CombinerInput containing paths to page results and output directory
   * @returns CombinerResult with paths to the generated output files
   */
  async runCombiner(input: CombinerInput): Promise<CombinerResult> {
    logger.info(`\n---> Running Document Combiner for ${input.baseFilename} <---`);
    
    const finalOutputs: Record<string, string> = {};
    const combinedPagesData: PageEntry[] = [];
    const loadErrors: PageLoadError[] = [];
    let successfulPageCount = 0;
    const encounteredFormats = new Set<string>();
    let runUuid: string | undefined;
    let originalS3Uri: string | undefined;
    
    if (!input.pageResultPaths || input.pageResultPaths.length === 0) {
      logger.warn('Combiner received no page result paths.');
      return {
        finalOutputs: {},
        status: 'NoInput',
        summary: { totalPages: 0, successfulPages: 0, errorCount: 0 }
      };
    }
    
    // 1. Load and validate page results
    for (const resultPath of input.pageResultPaths) {
      try {
        if (!fs.existsSync(resultPath)) {
          throw new Error('File not found');
        }
        logger.info(`Loading page result: ${resultPath}`);
        const pageDataStr = fs.readFileSync(resultPath, 'utf-8');
        const pageData: PageProcessorResult = JSON.parse(pageDataStr);
        
        // Basic validation (can be expanded)
        if (pageData.status === 'failed') {
            throw new Error(`Page processing reported failure: ${pageData.error || 'Unknown error'}`);
        }
        
        // Ensure we have both old structure (page_content) and new structure (extracted_output, grounded_output)
        // for backward compatibility during transition
        if ((!pageData.extracted_output || !pageData.grounded_output) && 
            (!pageData.page_content || pageData.page_content.grounded === undefined)) {
          throw new Error('Missing essential fields (extracted_output/grounded_output or page_content.grounded) in page result JSON');
        }
        
        // Get values from either new structure or old structure
        const extractedOutput = pageData.extracted_output || 
                              (pageData.page_content ? pageData.page_content.extracted : null);
        const groundedOutput = pageData.grounded_output || 
                             (pageData.page_content ? pageData.page_content.grounded : null);
        
        // Track format
        encounteredFormats.add(pageData.output_format);
        
        // Extract relevant data for PageEntry
        const pageEntry: PageEntry = {
          page_number: pageData.page_number,
          original_image_s3_uri: pageData.s3_image_uri || null,
          original_raw_text_s3_uri: pageData.s3_raw_text_uri || null,
          output_format: pageData.output_format,
          
          // Use flat structure matching Python version
          extracted_output: extractedOutput,
          grounded_output: groundedOutput,
          
          image_descriptions: pageData.image_descriptions,
          s3_detected_image_uris: pageData.s3_detected_image_uris
        };

        // Store the run_uuid if not already set
        if (pageData.run_uuid && !runUuid) {
          runUuid = pageData.run_uuid;
        }

        // Store the first original S3 URI we encounter
        if (pageData.s3_image_uri && !originalS3Uri && pageData.s3_image_uri.startsWith('s3://')) {
          // Extract the base S3 URI (up to the specific page file)
          const parts = pageData.s3_image_uri.split('/');
          // Remove the last part (specific page file)
          parts.pop();
          // Keep the document-level S3 URI
          originalS3Uri = parts.join('/');
        }

        combinedPagesData.push(pageEntry);
        successfulPageCount++;
      } catch (error: any) {
        logger.error({ err: error, path: resultPath }, `Failed to load or validate page result`);
        loadErrors.push({
          path: resultPath,
          reason: `Failed to load/process: ${error.message || error}`,
        });
      }
    }
    
    // Sort pages
    combinedPagesData.sort((a, b) => a.page_number - b.page_number);
    
    // 2. Determine Overall Status
    let processingStatus = "Failed";
    if (successfulPageCount === input.pageResultPaths.length) {
        processingStatus = "Completed";
    } else if (successfulPageCount > 0) {
        processingStatus = "CompletedWithErrors";
    }
    
    // 3. Generate Aggregated JSON Output (always)
    const aggregatedJsonData: AggregatedJsonData = {
      document_metadata: {
        run_uuid: runUuid || uuidv4(), // Use the run_uuid from page results or generate a new one
        original_s3_uri: originalS3Uri || `s3://${S3_BUCKET_NAME}/inputs/${input.baseFilename}`, // Use detected or construct a default
        original_base_filename: input.baseFilename,
        total_pages_input_to_combiner: input.pageResultPaths.length,
        successful_pages_loaded: successfulPageCount,
        page_load_errors: loadErrors.length,
        processing_status: processingStatus,
        requested_output_format: getMainOutputFormat(encounteredFormats),
        formats_in_page_results: Array.from(encounteredFormats),
      },
      pages: combinedPagesData,
      errors_encountered_during_load: loadErrors
    };
    
    const jsonOutputPath = path.join(input.finalOutputDir, `${input.baseFilename}_aggregated_results.json`);
    try {
      logger.info('Saving aggregated JSON output...');
      fs.writeFileSync(jsonOutputPath, JSON.stringify(aggregatedJsonData, null, 2));
      finalOutputs['json'] = jsonOutputPath;
      logger.info(`Saved aggregated JSON to: ${jsonOutputPath}`);
    } catch (error: any) {
      logger.error({ err: error, path: jsonOutputPath }, `Failed to save aggregated JSON output`);
      const errorMessage = `Failed to save aggregated JSON: ${error.message || error}`;
      return {
        finalOutputs: {},
        status: 'Failure',
        summary: { totalPages: input.pageResultPaths.length, successfulPages: successfulPageCount, errorCount: loadErrors.length + 1 },
        error: errorMessage
      };
    }
    
    // 4. Generate other desired formats (if any)
    for (const format of input.desiredFormats) {
      if (format.toLowerCase() === 'json') continue;
      
      try {
        logger.info(`Generating output for format: ${format}`);
        let combinedContent = "";
        if (format.toLowerCase() === 'txt') {
          combinedContent = combinedPagesData
            .map(page => {
              const output = typeof page.grounded_output === 'string' 
                ? page.grounded_output 
                : JSON.stringify(page.grounded_output, null, 2);
              return `--- Page ${page.page_number} ---\n${output}`;
            })
            .join('\n\n');
        } else if (format.toLowerCase() === 'markdown') {
          combinedContent = combinedPagesData
            .map(page => {
              return typeof page.grounded_output === 'string'
                ? page.grounded_output
                : JSON.stringify(page.grounded_output, null, 2);
            })
            .join('\n\n---\n\n');
        } else if (format.toLowerCase() === 'html') {
          // For HTML, create a proper document structure like in Python implementation
          const htmlHead = '<!DOCTYPE html>\n<html>\n<head>\n<meta charset="UTF-8">\n<title>Document</title>\n<style>\n.page { margin-bottom: 30px; padding-bottom: 30px; border-bottom: 1px dashed #ccc; }\n</style>\n</head>\n<body>\n';
          const htmlFoot = '\n</body>\n</html>';
          
          const pageDivs = combinedPagesData.map((page, index) => {
            const content = typeof page.grounded_output === 'string'
              ? page.grounded_output
              : JSON.stringify(page.grounded_output, null, 2);
            return `<div class="page" id="page-${page.page_number}">\n${content}\n</div>`;
          });
          
          combinedContent = htmlHead + pageDivs.join('\n') + htmlFoot;
        } else {
            logger.warn(`Output generation for format '${format}' is not yet implemented.`);
            continue;
        }

        const outputPath = path.join(input.finalOutputDir, `${input.baseFilename}_combined.${format.toLowerCase() === 'html' ? 'html' : format}`);
        fs.writeFileSync(outputPath, combinedContent);
        finalOutputs[format] = outputPath;
        logger.info(`Saved combined ${format} output to: ${outputPath}`);
      } catch (error: any) {
        logger.error({ err: error, format }, `Failed to generate or save output for format: ${format}`);
        loadErrors.push({ path: `Combined ${format}`, reason: `Generation failed: ${error.message || error}` });
      }
    }
    
    // 5. Determine Final Status
    let finalStatus: CombinerResult['status'] = 'Failure';
    if (processingStatus === 'Completed') {
      finalStatus = 'Success';
    } else if (processingStatus === 'CompletedWithErrors') {
      finalStatus = 'SuccessWithErrors';
    }
    
    logger.info('Document combiner finished.');
    return {
      finalOutputs,
      status: finalStatus,
      summary: {
        totalPages: input.pageResultPaths.length,
        successfulPages: successfulPageCount,
        errorCount: loadErrors.length
      }
    };
  }
  
  /**
   * Extract page number from a filename path
   * @param filePath Path to the file
   * @returns Extracted page number or null if not found
   */
  private extractPageNumberFromPath(filePath: string): number | null {
    try {
      // Assuming format like 'basename_page_N_result.json'
      const stem = path.basename(filePath, path.extname(filePath));
      const parts = stem.split('_');
      
      if (parts.length >= 3 && parts[parts.length - 3] === 'page') {
        return parseInt(parts[parts.length - 2], 10);
      }
      
      return null;
    } catch (error) {
      return null;
    }
  }
} 