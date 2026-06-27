import imageCompression from 'browser-image-compression'
import { supabase } from './supabase'

// Compress client-side (max ~1280px long edge, JPEG) and upload to the photos
// bucket. Returns the public URL. Keeps us well within the 1 GB free tier.
export async function compressAndUpload(file: File, gameId: string): Promise<string> {
  const compressed = await imageCompression(file, {
    maxWidthOrHeight: 1280,
    maxSizeMB: 0.5,
    useWebWorker: true,
    fileType: 'image/jpeg',
  })
  const path = `${gameId}/${crypto.randomUUID()}.jpg`
  const { error } = await supabase.storage.from('photos').upload(path, compressed, {
    contentType: 'image/jpeg',
    upsert: false,
  })
  if (error) throw error
  return supabase.storage.from('photos').getPublicUrl(path).data.publicUrl
}
