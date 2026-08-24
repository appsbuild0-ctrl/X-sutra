/**
 * Tiny multipart/form-data parser for single-file uploads.
 * Returns an array of parts: { name, filename, contentType, body: Buffer }.
 * Body is buffered (uploads are size-capped upstream), so this is safe for our
 * 50 MB ceiling.
 */
export function parseMultipart(buffer, contentType) {
  const boundaryMatch = /boundary=("?)([^";]+)\1/i.exec(contentType || '')
  if (!boundaryMatch) throw new Error('Missing multipart boundary')
  const boundary = boundaryMatch[2].trim()
  const delimiter = Buffer.from(`--${boundary}`)
  const parts = []
  let pos = buffer.indexOf(delimiter)
  if (pos === -1) throw new Error('Malformed multipart body')

  pos += delimiter.length
  while (pos < buffer.length) {
    if (buffer[pos] === 0x2d && buffer[pos + 1] === 0x2d) break // closing "--"
    if (buffer[pos] === 0x0d && buffer[pos + 1] === 0x0a) pos += 2
    else throw new Error('Malformed multipart body')

    const headerEnd = buffer.indexOf('\r\n\r\n', pos)
    if (headerEnd === -1) throw new Error('Malformed multipart headers')
    const headerText = buffer.subarray(pos, headerEnd).toString('utf8')
    const bodyStart = headerEnd + 4
    const nextDelim = buffer.indexOf(delimiter, bodyStart)
    if (nextDelim === -1) throw new Error('Malformed multipart body')

    let bodyEnd = nextDelim - 2
    if (!(buffer[bodyEnd] === 0x0d && buffer[bodyEnd + 1] === 0x0a)) bodyEnd = nextDelim
    const partBody = buffer.subarray(bodyStart, bodyEnd)

    const headers = {}
    for (const line of headerText.split('\r\n')) {
      const idx = line.indexOf(':')
      if (idx === -1) continue
      headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim()
    }
    const cd = headers['content-disposition'] || ''
    const name = /name="([^"]*)"/i.exec(cd)?.[1] ?? ''
    const filename = /filename="([^"]*)"/i.exec(cd)?.[1] ?? ''
    parts.push({
      name,
      filename,
      contentType: headers['content-type'] || '',
      body: partBody
    })
    pos = nextDelim + delimiter.length
  }
  return parts
}
