# AI Image Enhancer Server

A FastAPI server running Real-ESRGAN and GFPGAN for AI-powered image enhancement.

## Features

- **Real-ESRGAN**: General image enhancement (deblur, denoise, restore details)
- **GFPGAN**: Face-specific enhancement (restores facial details)
- **Upscaling**: 2x, 3x, 4x resolution increase
- **Combined Processing**: Face enhancement + general enhancement in one call

## Quick Start

```bash
cd server
chmod +x start.sh
./start.sh
```

This will:
1. Create a Python virtual environment
2. Install all dependencies
3. Download AI models (~500MB)
4. Start the server on http://localhost:8000

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /` | Health check |
| `POST /enhance` | General image enhancement |
| `POST /upscale` | Image upscaling |
| `POST /enhance-face` | Face enhancement with GFPGAN |
| `POST /process` | Combined enhancement + upscaling |

## API Usage

```javascript
// Example: Enhance an image
const response = await fetch('http://localhost:8000/process', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        image: 'data:image/png;base64,...',  // Base64 image
        scale: 2,                             // 1, 2, 3, or 4
        enhance_face: true                    // Enable GFPGAN
    })
});
const result = await response.json();
// result.image contains the enhanced base64 image
```

## Requirements

- Python 3.8+
- GPU recommended (CUDA) for faster processing
- ~4GB disk space for models
