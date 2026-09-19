/**
 * Express's own default JSON body limit (100kb) is well under a base64-encoded
 * photo: a 5MB image (MAX_PHOTO_SIZE_BYTES in banquet.dto.ts / tasks.dto.ts)
 * becomes ~6.7MB of base64 text before the JSON envelope around it. This is
 * the limit both the real app (main.ts) and e2e tests configure instead,
 * comfortably above that with room for a few photos' worth of headroom.
 */
export const MAX_REQUEST_BODY_SIZE = '10mb';
