export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
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
  
  run_uuid: string;
  page_number: number;
  original_base_filename: string;
  s3_image_uri: string;
  s3_raw_text_uri?: string;
  s3CroppedImagesPrefix?: string;
}

export interface PageProcessorResult {
  run_uuid: string;
  page_number: number;
  original_base_filename: string;
  output_format: OutputFormat;
  s3_image_uri: string;
  s3_raw_text_uri?: string;

  extracted_output: any;
  grounded_output?: any;
  
  page_content: {
    extracted: any;
    grounded?: any;
  };
  
  image_descriptions: ImageDescription[];
  s3_detected_image_uris?: string[];

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
  coordinates: BoundingBox;
  cropped_image_path?: string;
  s3_cropped_image_uri?: string;
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