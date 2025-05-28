# Processor Microservice

Processes each page image (and optional text) with YOLO and LLMs (Gemini/OpenAI), saving structured results to S3. Designed for S3-driven, cloud-native pipelines.

## Usage

### Prerequisites
- Docker Desktop
- AWS credentials with S3 access
- Gemini or OpenAI API key (for LLM)

### Environment Variables
Set in your shell, `.env`, or `docker-compose.yml`:
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`, `AWS_REGION`
- `GEMINI_API_KEY` or `OPENAI_API_KEY`
- `YOLO_MODEL_PATH` (default: `/app/models/yolov10x_best.onnx`)
- `VISION_PROVIDER`, `GEMINI_MODEL_NAME`, `OPENAI_MODEL_NAME`, `MAX_IMAGE_DIMENSION`

### Running with Docker Compose
1. Edit `docker-compose.yml` with your S3 input/output paths, LLM keys, and credentials.
2. Run:
   ```sh
   docker compose -f docker-compose.yml up --build
   ```

### Arguments (in `docker-compose.yml` command)
- **S3 Page Image URI**: e.g. `s3://your-bucket/outputs/splitter/images/page_1.png`
- **Run UUID**: e.g. `your-run-uuid`
- **Page Number**: e.g. `1`
- **Output Format**: `json`, `markdown`, `html`, or `txt`
- **Original Base Filename**: e.g. `doc`
- **S3 Output Bucket**: e.g. `your-bucket`
- **S3 Page Text URI**: (optional) e.g. `s3://your-bucket/outputs/splitter/texts/page_1.txt`
- **S3 Cropped Images Prefix**: (optional)

### Example
```yaml
command:
  - "s3://your-bucket/outputs/splitter/images/page_1.png"
  - "your-run-uuid"
  - "1"
  - "json"
  - "doc"
  - "your-bucket"
  - "s3://your-bucket/outputs/splitter/texts/page_1.txt"
```

### Output
- S3 URI for processed page result, printed as JSON. 