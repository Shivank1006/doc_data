declare module 'libreoffice-convert' {
  /**
   * Convert a document to another format using LibreOffice
   * @param input Input document as Buffer
   * @param outputFormat Output format with dot (e.g., '.pdf')
   * @param filter Optional LibreOffice filter to use
   * @param callback Callback function to handle the result
   */
  export function convert(
    input: Buffer,
    outputFormat: string,
    filter: string | undefined,
    callback: (err: Error | null, result: Buffer) => void
  ): void;
} 