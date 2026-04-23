export function cleanExtractedText(text: string): string {
  return text
    .replace(/ﬀ/g, 'ff')
    .replace(/ﬁ/g, 'fi')
    .replace(/ﬂ/g, 'fl')
    .replace(/ﬃ/g, 'ffi')
    .replace(/ﬄ/g, 'ffl')
    .replace(/ﬅ/g, 'st')
    .replace(/ﬆ/g, 'st')
    .replace(/Ʋ/g, 'tt')
    .replace(//g, '•')
    .replace(//g, '•')
    .replace(/●/g, '•')
    .replace(/▪/g, '•')
    .replace(/■/g, '•')
    .replace(/–/g, '-')
    .replace(/[​‌‍﻿]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export async function extractTextFromFile(file: File): Promise<string> {
  const buffer = Buffer.from(await file.arrayBuffer())
  const name = file.name.toLowerCase()
  const mime = file.type

  if (mime === 'application/pdf' || name.endsWith('.pdf')) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require('pdf-parse')
    const data = await pdfParse(buffer)
    return cleanExtractedText(data.text as string)
  }

  if (
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    name.endsWith('.docx')
  ) {
    const mammoth = await import('mammoth')
    const result = await mammoth.extractRawText({ buffer })
    return cleanExtractedText(result.value)
  }

  throw new Error('Unsupported file type - please upload a PDF or DOCX')
}
