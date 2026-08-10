interface ParsedNDJSONResult {
  meta: any;
  data: any[];
}

export async function parseNDJSON(
  response: Response | string,
): Promise<ParsedNDJSONResult> {
  // API requests normally pass an already-consumed string so their timeout
  // and AbortSignal remain active through body consumption. Keeping Response
  // support makes the utility reusable and preserves any AbortError from
  // response.text().
  const responseText =
    typeof response === "string" ? response : await response.text();

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

    let json: any;
    try {
      json = JSON.parse(line);
    } catch (error) {
      // A malformed line must not discard valid records that follow it.
      // Runtime/backend errors, however, are handled outside this block.
      if (error instanceof SyntaxError) continue;
      throw error;
    }

    if (json.meta) {
      meta = json.meta;
    } else if (json.error) {
      throw new Error(json.error.message || "Erro no stream de dados");
    } else if (json && typeof json === "object") {
      data.push(json);
    }
  }

  return { meta, data };
}
