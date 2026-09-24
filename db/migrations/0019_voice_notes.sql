-- Voice notes in messages: the audio file lives in storage under the tenant prefix; the row keeps the key, type and length.
ALTER TABLE messages
  ADD COLUMN voice_key     text,
  ADD COLUMN voice_mime    text CHECK (voice_mime IS NULL OR voice_mime IN ('audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav')),
  ADD COLUMN voice_seconds integer CHECK (voice_seconds IS NULL OR voice_seconds BETWEEN 1 AND 600);
