# Splitter Microservice

Splits input documents (PDF, DOCX, PPTX) into per-page images and text, saving results to S3. Designed for S3-driven, cloud-native pipelines.

## Usage

### Prerequisites
- Docker Desktop
- AWS credentials with S3 access

### Environment Variables
Set in your shell, `.env`, or `docker-compose.yml`:
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`, `AWS_REGION`

### Running with Docker Compose
1. Edit `docker-compose.yml` with your S3 input/output paths and credentials.
2. Run:
   ```sh
   docker compose -f docker-compose.yml up --build
   ```

### Arguments (in `docker-compose.yml` command)
- **Input PDF S3 URI**: e.g. `s3://your-bucket/inputs/doc.pdf`
- **Image Output S3 Dir**: e.g. `s3://your-bucket/outputs/splitter/images`
- **Text Output S3 Dir**: e.g. `s3://your-bucket/outputs/splitter/texts`
- **Output Format**: `json` or `txt` (default: `json`)

### Example
```yaml
command:
  - "s3://your-bucket/inputs/doc.pdf"
  - "s3://your-bucket/outputs/splitter/images"
  - "s3://your-bucket/outputs/splitter/texts"
  - "json"
```

### Output
- S3 URIs for per-page images and text files, printed as JSON.

## Technical Documentation

The Document Splitter takes input files (PDF, DOCX, PPTX, images) and:

1. For images:
   - Converts them to a standardized PNG format
   - Saves them to the output directory

2. For PDFs:
   - Extracts text from each page
   - Converts each page to an image
   - Outputs both text and image files for further processing

3. For Office Documents (DOCX, PPTX):
   - Converts to PDF using LibreOffice
   - Then processes like PDF files

## Usage

```typescript
import { DocumentSplitter } from './splitter';
import { SplitterInput } from './models/splitterTypes';

// Create a splitter instance
const splitter = new DocumentSplitter({
  pdfDpi: 200 // Configure DPI for PDF rendering
});

// Prepare input parameters
const input: SplitterInput = {
  sourceFilePath: '/path/to/document.jpg',
  outputFormat: 'json', // Format for the processor
  tempDir: '/path/to/temp',
  imageOutputDir: '/path/to/images',
  textOutputDir: '/path/to/text'
};

// Process the document
const result = await splitter.runSplitter(input);

// Check results
if (result.status === 'success') {
  console.log(`Generated ${result.pageImagePaths.length} images`);
  console.log(`Extracted text from ${result.pageTextPaths.length} pages`);
}
``` 