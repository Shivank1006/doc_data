import { SFNClient, StartExecutionCommand, DescribeExecutionCommand } from "@aws-sdk/client-sfn";

// If you prefer, set env-vars here in code; otherwise rely on the shell.
// process.env.AWS_ACCESS_KEY_ID     = "…";
// process.env.AWS_SECRET_ACCESS_KEY = "…";
// process.env.AWS_SESSION_TOKEN     = "…";

const sfn = new SFNClient({
  region: "us-east-1",                 // credentials come from env by default
  // credentials: defaultProvider()    // ← explicit call works too but isn't required
});

/*
Examples:
s3://doc-data-extraction-test/inputs/bio_page_1.png
s3://doc-data-extraction-test/inputs/bio-1746549488752.pdf
s3://doc-data-extraction-test/inputs/Consulting_proposal.pptx
s3://doc-data-extraction-test/inputs/Resume.docx
*/

async function run() {
  // start the execution
  const start = await sfn.send(new StartExecutionCommand({
    stateMachineArn: "arn:aws:states:us-east-1:123456789012:stateMachine:DocumentProcessingPipeline",
    input: JSON.stringify({ s3_input_uri: "inputs/Resume.docx", output_format: "json" }),
  }));                                  // SFN returns { executionArn, startDate }
  const execArn = start.executionArn!;
  console.log("Started", execArn);      // ← same as Python

  // optional: poll until the workflow finishes
  let status = "RUNNING";
  while (status === "RUNNING") {
    const resp = await sfn.send(new DescribeExecutionCommand({ executionArn: execArn }));
    status = resp.status ?? "UNKNOWN";
    await new Promise(res => setTimeout(res, 2000));
  }
}
run().catch(console.error);
