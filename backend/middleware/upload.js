const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || './uploads');
const PROFILE_PICS_DIR = path.join(UPLOAD_DIR, 'profile-pics');
if (!fs.existsSync(PROFILE_PICS_DIR)) fs.mkdirSync(PROFILE_PICS_DIR, { recursive: true });

const MAX_BYTES = (parseInt(process.env.MAX_UPLOAD_MB || '5', 10)) * 1024 * 1024;

// Memory storage: we never trust or write the raw uploaded bytes directly to disk.
// Everything is re-encoded through sharp first, which both validates it's a real image
// (rejecting disguised/malformed files) and strips EXIF/metadata.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error('Only JPEG, PNG, or WEBP images are allowed'));
    }
    cb(null, true);
  }
});

// Processes the buffer from multer: validates it decodes as an image, resizes/crops to a
// square avatar, strips metadata, and writes it under a filename keyed to the user id
// (so there's one current profile picture per user and old ones are overwritten, not
// accumulated). Returns the path stored in the DB (relative, not web-servable directly).
async function processAndSaveProfilePic(buffer, userId) {
  const filename = `${userId}.webp`;
  const destPath = path.join(PROFILE_PICS_DIR, filename);

  await sharp(buffer)
    .rotate() // respect EXIF orientation before stripping it
    .resize(512, 512, { fit: 'cover' })
    .webp({ quality: 82 })
    .toFile(destPath);

  return `profile-pics/${filename}`;
}

function profilePicAbsolutePath(relativePath) {
  return path.join(UPLOAD_DIR, relativePath);
}

module.exports = { upload, processAndSaveProfilePic, profilePicAbsolutePath, PROFILE_PICS_DIR, UPLOAD_DIR };
