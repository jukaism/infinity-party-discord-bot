export const chunkString = (str: string, chunkSize: number): string[] => {
  const chunks = []
  let i = 0
  while (i < str.length) {
    chunks.push(str.slice(i, i + chunkSize))
    i += chunkSize
  }
  return chunks
}
