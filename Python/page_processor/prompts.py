# --- Prompts for Gemini ---
JSON_EXTRACTION_PROMPT = """Analyze the provided page image and generate a structured JSON representation of its content.

Follow these instructions precisely:
1.  JSON Structure: The output MUST be a single JSON object. The root object should contain a "page_content" key, which is an array of elements representing the document structure in reading order.
2.  Element Types: Each element in the "page_content" array should be an object with a "type" key. Supported types: "heading", "paragraph", "list", "table", "image_description".
3.  Headings: For "heading" elements, include a "level" key (integer 1-6) and a "text" key.
4.  Paragraphs: For "paragraph" elements, include a "text" key containing the full paragraph text.
5.  Lists: For "list" elements, include an "items" key which is an array of strings. Include an "ordered" key (boolean, true for numbered lists, false for bulleted).
6.  Tables: For "table" elements, include a "header" key (array of strings) and a "rows" key (array of arrays of strings). Preserve the cell content accurately.
7.  Numbered Images: Pay special attention to the numbered images indicated by red bounding boxes (e.g., #1, #2). There are {num_images} images found in total, indexed from 1 to {max_image_index}. When you encounter a numbered image in the document flow, insert an element object with:
    *   "type": "image_description"
    *   "image_id": N (where N is the integer number from the red box, e.g., 0, 1, 2)
    *   "description": "[START DESCRIPTION]A concise description of the image content. If the image is a chart, graph, or diagram, then give a very detailed description of the image, explaining what the image is showing.[END DESCRIPTION]"
    *   **IMPORTANT**: You MUST enclose the image description within the `[START DESCRIPTION]` and `[END DESCRIPTION]` markers.
8.  Accuracy: Preserve all text content exactly as written. Maintain the original structure and reading order.
9.  Validity: Ensure the final output is a valid JSON object. Do NOT wrap the JSON in markdown backticks or add any explanatory text outside the JSON structure.

Keep in mind that there are {num_images} images found in total, indexed from 1 to {max_image_index}.

Begin the JSON output now:"""

TXT_EXTRACTION_PROMPT = """Analyze the provided page image and extract its text content.

Follow these instructions precisely:
1.  Extract All Text: Capture all readable text from the image.
2.  Preserve Reading Order: Maintain the logical flow and reading order of the text as it appears on the page.
3.  Paragraphs: Separate paragraphs with a single blank line.
4.  Lists: Format bulleted lists with a '*' or '-' prefix, and numbered lists with '1.', '2.', etc.
5.  Tables: Represent table content row by row, separating cells with tabs (\t).
6.  Image Descriptions: There are {num_images} images found in total, indexed from 1 to {max_image_index}. For these numbered images (e.g., #1, #2), insert a description on a new line like: "[Image #N: [START DESCRIPTION]Description[END DESCRIPTION]]" where the image appears in the flow. Replace 'Description' with the actual description. If the images are charts, graphs, or diagrams then give a very detailed description of the image, explaining what the image is showing.
    *   **IMPORTANT**: You MUST enclose the image description within the `[START DESCRIPTION]` and `[END DESCRIPTION]` markers.
7.  No Formatting: Do not include any Markdown, HTML, or other formatting codes.
8.  Accuracy: Preserve the exact text content.

Keep in mind that there are {num_images} images found in total, indexed from 1 to {max_image_index}.

Begin the plain text output now:"""

HTML_EXTRACTION_PROMPT = """Analyze the provided page image and generate a semantic HTML5 representation of its content.

Follow these instructions precisely:
1.  HTML Structure: Output valid HTML5. Use semantic tags like `<article>`, `<section>`, `<h1>`-`<h6>`, `<p>`, `<ul>`, `<ol>`, `<li>`, `<table>`, `<thead>`, `<tbody>`, `<tr>`, `<th>`, `<td>`.
2.  Reading Order: Maintain the logical reading order of the elements.
3.  Headings: Use appropriate heading levels (`<h1>` to `<h6>`).
4.  Paragraphs: Wrap paragraphs in `<p>` tags.
5.  Lists: Use `<ul>` for bulleted lists and `<ol>` for numbered lists, with list items in `<li>` tags.
6.  Tables: Use `<table>` with `<thead>`, `<tbody>`, `<tr>`, `<th>` (for headers), and `<td>` (for data cells).
7.  Image Descriptions: There are {num_images} images found in total, indexed from 1 to {max_image_index}. For these numbered images (e.g., #1, #2), insert a placeholder paragraph like: `<p class="image-placeholder" data-image-id="N">[Image #N: [START DESCRIPTION]Description of image content[END DESCRIPTION]]</p>` where the image appears in the flow. Replace N with the image number and provide the description. If the images are charts, graphs, or diagrams then give a very detailed description of the image, explaining what the image is showing.
    *   **IMPORTANT**: You MUST enclose the image description within the `[START DESCRIPTION]` and `[END DESCRIPTION]` markers.
8.  Accuracy: Preserve all text content exactly within the HTML tags.
9.  No Extra Styling: Do not add CSS styles or `<style>` blocks. Focus on semantic structure.
10. Validity: Ensure the output is well-formed HTML5.

Keep in mind that there are {num_images} images found in total, indexed from 1 to {max_image_index}.

Begin the HTML output now:"""

MARKDOWN_EXTRACTION_PROMPT = """Analyze the provided page image and generate a structured representation of its content using Markdown format.

Follow these instructions precisely:
1.  Preserve Structure: Identify headings (using appropriate # levels), paragraphs, lists (bulleted using * or -, numbered using 1., 2., etc.), and blockquotes (>). Maintain the logical reading order.
2.  Extract Text: Accurately extract all text content within identified elements.
3.  Format Tables: Represent any tables using Markdown table syntax (with headers denoted by | --- | separators).
4.  Describe Numbered Images: There are {num_images} images found in total, indexed from 1 to {max_image_index}. Pay special attention to these numbered images indicated by red bounding boxes (e.g., #0, #1, #2). For each numbered image found, provide its description on a new line prefixed with 'Image #N: [START DESCRIPTION]description[END DESCRIPTION]' (where N is the number) exactly where the image appears in the document flow. Replace 'description' with the actual description. If the images are charts, graphs, or diagrams then give a very detailed description of the image, explaining what the image is showing.
    *   **IMPORTANT**: You MUST enclose the image description within the `[START DESCRIPTION]` and `[END DESCRIPTION]` markers.
5.  Output Format: Ensure the entire output is valid Markdown.

Keep in mind that there are {num_images} images found in total, indexed from 1 to {max_image_index}.

Begin the Markdown output now:"""


GROUNDING_PROMPT_TEXT = """Review the following 'Extracted Text' section based ONLY on the information present in the 'Raw Text' section. Correct any factual inaccuracies or misinterpretations found in the 'Extracted Text' compared to the 'Raw Text'. If the 'Raw Text' is missing information or contradicts the 'Extracted Text' but the 'Extracted Text' seems plausible based on document structure (like headings, lists), prioritize keeping the structured 'Extracted Text'.

If no corrections are needed, return the 'Extracted Text' exactly as it is. Do NOT add any new information not present in the original 'Extracted Text'. Do NOT add explanations or commentary. Output only the corrected (or original) text.

Extracted text can in 4 different formats:
1. Markdown
2. HTML
3. JSON
4. Text

Always maintain the original format of the extracted text in your response. 

[Raw Text]
{raw_text}
[End Raw Text]

[Extracted Text]
{extracted_text}
[End Extracted Text]

Corrected Text:"""