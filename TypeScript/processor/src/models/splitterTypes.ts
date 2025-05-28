export type DocType = 'pdf' | 'docx' | 'pptx' | 'image' | 'unsupported';

export interface SplitterInput {
  sourceFilePath: string;
  outputFormat: string;
  tempDir: string;
  imageOutputDir: string;
  textOutputDir: string;
}

export interface SplitterResult {
  runUuid: string;
  originalBaseFilename: string;
  pageTextPaths: string[];
  pageImagePaths: string[];
  docType: string;
  originalFilename: string;
  status: string;
  error?: string;
}

export interface SplitterConfig {
  pdfDpi: number;
  preserveColors: boolean;
  imageQuality: number;
}

// Default configuration
export const DEFAULT_SPLITTER_CONFIG: SplitterConfig = {
  pdfDpi: 300,
  preserveColors: true,
  imageQuality: 100
};
