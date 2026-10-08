import fs from 'node:fs';
import path from 'node:path';
export const MAX_DOCUMENT_SIZE_BYTES = 15 * 1024 * 1024; // 15 MB
export const MAX_PHOTO_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_DOC_EXTENSIONS = new Set([
    'pdf', 'png', 'jpg', 'jpeg', 'jfif', 'avif', 'webp', 'svg',
    'xlsx', 'xls', 'csv', 'docx', 'doc', 'zip', 'rar', 'txt', 'json'
]);
const ALLOWED_PHOTO_EXTENSIONS = new Set([
    'jpg', 'jpeg', 'jfif', 'avif', 'png', 'webp', 'svg'
]);
const FORBIDDEN_EXTENSIONS = new Set([
    'exe', 'bat', 'cmd', 'sh', 'js', 'mjs', 'cjs', 'html', 'htm',
    'php', 'py', 'jar', 'msi', 'vbs', 'scr', 'dll', 'com'
]);
export class StorageService {
    baseDir;
    constructor(baseDir) {
        this.baseDir = baseDir || path.resolve(process.cwd(), 'uploads');
        this.ensureDirectory(this.baseDir);
    }
    getBaseDir() {
        return this.baseDir;
    }
    /**
     * Verify path is strictly contained within baseDir to prevent traversal attacks
     */
    isPathWithinBaseDir(targetPath) {
        const resolved = path.resolve(targetPath);
        const resolvedBase = path.resolve(this.baseDir);
        return resolved.startsWith(resolvedBase);
    }
    /**
     * Sanitize filename for HTTP download header
     */
    sanitizeFileName(fileName) {
        return fileName.replace(/[/\\?%*:|"<>]/g, '_').replace(/[\r\n]/g, '').trim() || 'file';
    }
    /**
     * Validate file size and extension
     */
    validateFile(fileName, sizeBytes, mimeType, isPhoto = false) {
        const ext = fileName.split('.').pop()?.toLowerCase() || '';
        if (FORBIDDEN_EXTENSIONS.has(ext)) {
            throw new Error(`Executable and script file uploads are strictly forbidden (.${ext})`);
        }
        if (isPhoto) {
            if (!ALLOWED_PHOTO_EXTENSIONS.has(ext)) {
                throw new Error(`Invalid photo file format .${ext}. Allowed formats: JPG, PNG, WEBP, SVG`);
            }
            if (sizeBytes > MAX_PHOTO_SIZE_BYTES) {
                throw new Error(`Photo file size exceeds maximum limit of 10 MB (${(sizeBytes / (1024 * 1024)).toFixed(2)} MB)`);
            }
        }
        else {
            if (!ALLOWED_DOC_EXTENSIONS.has(ext)) {
                throw new Error(`Invalid document file format .${ext}. Allowed: PDF, Images, Word, Excel, ZIP, TXT`);
            }
            if (sizeBytes > MAX_DOCUMENT_SIZE_BYTES) {
                throw new Error(`Document file size exceeds maximum limit of 15 MB (${(sizeBytes / (1024 * 1024)).toFixed(2)} MB)`);
            }
        }
    }
    /**
     * Ensure directory exists
     */
    ensureDirectory(dirPath) {
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }
    }
    /**
     * Save a binary buffer to disk with security validation
     */
    async saveBuffer(subfolder, fileName, buffer, mimeType = 'application/octet-stream', isPhoto = false) {
        this.validateFile(fileName, buffer.length, mimeType, isPhoto);
        // Sanitize subfolder to prevent path traversal
        const safeSubfolder = subfolder.replace(/\.\./g, '').replace(/^[/\\]+/, '');
        const targetDir = path.join(this.baseDir, safeSubfolder);
        if (!this.isPathWithinBaseDir(targetDir)) {
            throw new Error('Invalid upload destination path');
        }
        this.ensureDirectory(targetDir);
        const safeBaseName = this.sanitizeFileName(fileName);
        const safeFileName = `${Date.now()}_${safeBaseName}`;
        const fullPath = path.join(targetDir, safeFileName);
        if (!this.isPathWithinBaseDir(fullPath)) {
            throw new Error('Invalid file path resolution');
        }
        await fs.promises.writeFile(fullPath, buffer);
        return {
            fileName: safeFileName,
            filePath: fullPath,
            fileSizeBytes: buffer.length,
            mimeType,
        };
    }
    /**
     * Save a base64 encoded data URI or string
     */
    async saveBase64(subfolder, fileName, dataUri, defaultMime = 'image/png', isPhoto = false) {
        let mimeType = defaultMime;
        let base64Data = dataUri;
        const match = dataUri.match(/^data:([^;]+);base64,(.+)$/);
        if (match) {
            mimeType = match[1];
            base64Data = match[2];
        }
        const buffer = Buffer.from(base64Data, 'base64');
        return this.saveBuffer(subfolder, fileName, buffer, mimeType, isPhoto);
    }
    /**
     * Delete a file from disk
     */
    async deleteFile(filePath) {
        try {
            if (this.isPathWithinBaseDir(filePath) && fs.existsSync(filePath)) {
                await fs.promises.unlink(filePath);
                return true;
            }
            return false;
        }
        catch (err) {
            console.error(`Failed to delete file at ${filePath}:`, err);
            return false;
        }
    }
    /**
     * Check if file exists
     */
    fileExists(filePath) {
        return this.isPathWithinBaseDir(filePath) && fs.existsSync(filePath);
    }
    /**
     * Read file stream
     */
    getReadStream(filePath) {
        if (!this.isPathWithinBaseDir(filePath)) {
            throw new Error('Access to path outside upload directory is forbidden');
        }
        return fs.createReadStream(filePath);
    }
}
export const storageService = new StorageService();
