declare module 'pdf-parse' {
  interface PDFData {
    text: string;
    numpages: number;
    info: {
      PDFFormatVersion?: string;
      IsAcroFormPresent?: boolean;
      IsXFAPresent?: boolean;
      Title?: string;
      Author?: string;
      Subject?: string;
      Keywords?: string;
      Creator?: string;
      Producer?: string;
      CreationDate?: string;
      ModDate?: string;
    };
    metadata: any;
    version: string;
  }

  function parse(
    dataBuffer: Buffer | Uint8Array,
    options?: {
      pagerender?: (pageData: any) => Promise<string>;
      max?: number;
    }
  ): Promise<PDFData>;

  export = parse;
} 