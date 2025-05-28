export type DocType = 'pdf' | 'docx' | 'pptx' | 'image' | 'unsupported';

export interface SplitterConfig {
  maxPageSize: number;
  pageImageFormat: 'png' | 'jpg';
  pageTextFormat: 'txt' | 'json';
  enableRawTextExtraction: boolean;
  pdfToPngDPI: number;
  maxImagesPerPDF: number;
}

export const DEFAULT_SPLITTER_CONFIG: SplitterConfig = {
  maxPageSize: 8000, // Maximum pixels in width or height
  pageImageFormat: 'png',
  pageTextFormat: 'json',
  enableRawTextExtraction: true,
  pdfToPngDPI: 300,
  maxImagesPerPDF: 500 // Safety limit
};

export interface SplitterInput {
  sourceFilePath: string;
  tempDir: string;
  imageOutputDir: string;
  textOutputDir: string;
  outputFormat?: string;
}

export interface SplitterResult {
  pageImagePaths: string[];
  pageTextPaths: string[];
  docType: DocType;
  originalFilename: string;
  originalBaseFilename: string;
  status: 'success' | 'failed';
  error?: string;
} 