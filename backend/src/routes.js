const express = require('express');
const router = express.Router();
const { getInfo, downloadMedia, subscribeProgress } = require('./downloader');

// GET /api/info?url={url}
router.get('/info', async (req, res, next) => {
    try {
        const { url } = req.query;
        if (!url) {
            return res.status(400).json({ error: 'URL parameter is required.' });
        }
        const info = await getInfo(url);
        res.json(info);
    } catch (error) {
        next(error);
    }
});

// GET /api/download?url={url}&format={audio|video}&quality={best|1080|720}&id={taskId}
router.get('/download', (req, res, next) => {
    try {
        const { url, format, quality, id } = req.query;
        if (!url || !format || !id) {
            return res.status(400).json({ error: 'Missing required parameters.' });
        }

        downloadMedia(req, res, { url, format, quality, id });
    } catch (error) {
        next(error);
    }
});

// GET /api/progress?id={taskId}
router.get('/progress', (req, res) => {
    const { id } = req.query;
    if (!id) {
        return res.status(400).json({ error: 'Task ID is required for SSE.' });
    }
    subscribeProgress(id, req, res);
});

module.exports = router;
