declare module 'pdf-poppler' {
  export interface PdfInfo {
    pages: number;
    title?: string;
    author?: string;
    subject?: string;
    keywords?: string;
    creator?: string;
    producer?: string;
    format?: string;
    creationDate?: Date;
    modDate?: Date;
    tagged?: boolean;
    form?: string;
    linearized?: boolean;
    encrypted?: boolean;
    size?: number;
    pageSize?: {
      width: number;
      height: number;
      unit: string;
    };
  }

  export interface ConvertOptions {
    format?: 'jpeg' | 'png' | 'tiff';
    out_dir: string;
    out_prefix?: string;
    page?: number | number[];
    scale?: number;
    dpi?: number;
    density?: number;
  }

  export function info(pdfPath: string): Promise<PdfInfo>;
  export function convert(pdfPath: string, options: ConvertOptions): Promise<void>;
} 