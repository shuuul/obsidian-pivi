const XML_CONTEXT_PATTERN = /\n\n<(?:current_note|editor_selection|editor_cursor|inline_contexts|context_files|canvas_selection|browser_selection)[\s>]/;

function stripXmlContextTags(text: string): string {
  return text
    .replace(/<current_note>[\s\S]*?<\/current_note>\s*/g, '')
    .replace(/<editor_selection[\s\S]*?<\/editor_selection>\s*/g, '')
    .replace(/<editor_cursor[\s\S]*?<\/editor_cursor>\s*/g, '')
    .replace(/<inline_contexts>[\s\S]*?<\/inline_contexts>\s*/g, '')
    .replace(/<context_files>[\s\S]*?<\/context_files>\s*/g, '')
    .replace(/<canvas_selection[\s\S]*?<\/canvas_selection>\s*/g, '')
    .replace(/<browser_selection[\s\S]*?<\/browser_selection>\s*/g, '')
    .trim();
}

function extractContentBeforeXmlContext(text: string): string | undefined {
  if (!text) return undefined;

  const queryMatch = text.match(/<query>\n?([\s\S]*?)\n?<\/query>/);
  if (queryMatch) {
    return queryMatch[1].trim();
  }

  const xmlMatch = text.match(XML_CONTEXT_PATTERN);
  if (xmlMatch?.index !== undefined) {
    return stripXmlContextTags(text.substring(0, xmlMatch.index));
  }

  return undefined;
}

export function extractUserQuery(prompt: string): string {
  if (!prompt) return '';
  return extractContentBeforeXmlContext(prompt) ?? stripXmlContextTags(prompt);
}
