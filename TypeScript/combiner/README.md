# Combiner Microservice

Aggregates per-page processor results into a final output (JSON, Markdown, etc.), saving to S3. Designed for S3-driven, cloud-native pipelines.

## Usage

### Prerequisites
- Docker Desktop
- AWS credentials with S3 access

### Environment Variables
Set in your shell, `.env`, or `docker-compose.yml`:
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`, `AWS_REGION`
- `S3_BUCKET_NAME` (for output)
- `FINAL_OUTPUT_PREFIX` (optional, default: `outputs/combiner`)

### Running with Docker Compose
1. Edit `docker-compose.yml` with your S3 input/output paths and credentials.
2. Run:
   ```sh
   docker compose -f docker-compose.yml up --build
   ```

### Arguments (in `docker-compose.yml` command)
- **Run UUID**: e.g. `your-run-uuid`
- **Output Format**: `json`, `markdown`, `html`, or `txt`
- **Original Base Filename**: e.g. `doc`
- **Original S3 URI**: e.g. `s3://your-bucket/inputs/doc.pdf`
- **S3 Page Result URIs**: comma-separated S3 URIs for all page results

### Example
```yaml
command:
  - "your-run-uuid"
  - "json"
  - "doc"
  - "s3://your-bucket/inputs/doc.pdf"
  - "s3://your-bucket/outputs/processor/your-run-uuid/doc_page_1.json,s3://your-bucket/outputs/processor/your-run-uuid/doc_page_2.json"
```

### Output
- S3 URI for the final aggregated result, printed as JSON. 