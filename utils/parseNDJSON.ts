interface ParsedNDJSONResult {
  meta: any;
  data: any[];
}

export async function parseNDJSON(
  response: Response,
): Promise<ParsedNDJSONResult> {
  try {
    // React Native fetch automatically handles gzip decompression
    // We can directly use response.text()
    const responseText = await response.text();

    if (!responseText.trim()) {
      return { meta: null, data: [] };
    }

    // Split by newlines and filter empty lines
    const lines = responseText.split("\n").filter((line) => line.trim());

    let meta: any = null;
    const data: any[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      try {
        const json = JSON.parse(line);

        // Check if it's the metadata object
        if (json.meta) {
          meta = json.meta;
        } else if (json.error) {
          throw new Error(json.error.message || "Erro no stream de dados");
        } else {
          // This is a data item - ensure it's a valid object
          if (json && typeof json === "object") {
            data.push(json);
          }
        }
      } catch (parseError) {
        // Continue processing other lines instead of throwing
        continue;
      }
    }

    return { meta, data };
  } catch (error) {
    throw error;
  }
}
