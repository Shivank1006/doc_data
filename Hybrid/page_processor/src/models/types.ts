export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

// For Python compatibility, add interface with coordinates in [x1, y1, x2, y2] format
export interface PythonFormatBoundingBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface DetectedElement {
  type: ElementType;
  boundingBox: BoundingBox;
  confidence: number;
  content?: string;
  imageUri?: string;
}

export enum ElementType {
  TEXT = 'text',
  IMAGE = 'image',
  TABLE = 'table',
  CHART = 'chart',
  DIAGRAM = 'diagram',
  FORMULA = 'formula',
  HEADER = 'header',
  FOOTER = 'footer'
}

export interface ProcessorConfig {
  outputFormat: 'json' | 'markdown' | 'html' | 'txt';
  confidenceThreshold: number;
  modelPath: string;
}

export interface PageProcessorInput {
  imagePath: string;
  rawTextFilePath?: string;
  outputFormat: OutputFormat;
  outputPath?: string;
  croppedImagesDir?: string;
  
  // Properties from Python implementation
  run_uuid: string;
  page_number: number;
  original_base_filename: string;
  s3_image_uri: string;
  s3_raw_text_uri?: string;
  s3CroppedImagesPrefix?: string;

  // Alternative paths used in some variants (TypeScript only)
  s3ImagePath?: string;
}

export interface PageProcessorResult {
  run_uuid: string;
  page_number: number;
  original_base_filename: string;
  output_format: OutputFormat;
  s3_image_uri?: string;
  s3_raw_text_uri?: string;
  
  // Match Python structure with flat fields instead of nested page_content
  extracted_output: any;
  grounded_output: any;
  
  // Keep page_content for backward compatibility, but it will be deprecated
  page_content?: {
    extracted: any;
    grounded: any;
  };
  
  image_descriptions: ImageDescription[];
  s3_detected_image_uris?: Record<string, string>; // Map of image_id (as string) to S3 URI
  status: 'success' | 'failed';
  error?: string;
}

export interface LlmResponse {
  text: string;
  success: boolean;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface ImageDescription {
  image_id: number;
  description: string;
  coordinates: BoundingBox | number[]; // Support both formats for coordinates
  
  // This field will now only store S3 URIs for compatibility with Python version
  cropped_image_path: string;
  
  // Keep for internal use but will be removed from final output
  _local_cropped_image_path?: string;
  s3_cropped_image_uri?: string;
}

export interface HandlerImageDescription {
  index: number;
  description: string;
  s3_uri: string;
  coordinates?: number[];
}

export interface CombinerInput {
  baseFilename: string;
  pageResultPaths: string[];
  tempDir: string;
  finalOutputDir: string;
  desiredFormats: string[];
}

export interface CombinerResult {
  finalOutputs: Record<string, string>;
  status: 'Success' | 'SuccessWithErrors' | 'Failure' | 'NoInput';
  summary: {
    totalPages: number;
    successfulPages: number;
    errorCount: number;
  };
}

export interface PageEntry {
  pageNumber: number;
  originalImagePath?: string;
  outputFormat: string;
  groundedOutput: any;
  extractedOutput?: any;
  imageDescriptions: ImageDescription[];
}

export interface PageLoadError {
  path: string;
  reason: string;
  pageNumEstimated?: number;
}

export interface AggregatedJsonData {
  documentMetadata: {
    baseFilename: string;
    totalPagesInput: number;
    successfulPagesLoaded: number;
    pageLoadErrors: number;
    processingStatus: string;
    formatsInPageResults: string[];
  };
  pages: PageEntry[];
  errorsEncountered: PageLoadError[];
}

export type OutputFormat = 'markdown' | 'json' | 'txt' | 'html'; 