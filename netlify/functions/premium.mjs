import { addPost, adminPassword, json, readPosts } from './_premium-store.mjs'

export const handler = async (event) => {
  try {
    if (event.httpMethod === 'GET') {
      return json(200, { posts: await readPosts() })
    }

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body ?? '{}')
      if (body.password !== adminPassword()) return json(403, { error: 'Admin password required.' })
      const { posts } = await addPost({
        title: body.title,
        videoUrl: body.videoUrl,
        thumbnail: body.thumbnail,
        source: 'web'
      })
      return json(200, { posts })
    }

    return json(405, { error: 'GET and POST only.' })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Premium posts unavailable.'
    return json(message.includes('valid video') ? 400 : 500, { error: message })
  }
}
