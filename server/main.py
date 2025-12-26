"""
AI Image Enhancer Server
FastAPI server with Real-ESRGAN and GFPGAN for image enhancement

Endpoints:
- POST /enhance - General image enhancement (deblur, denoise, restore)
- POST /upscale - Image upscaling with AI
- POST /enhance-face - Face-focused enhancement with GFPGAN
- POST /process - Combined enhancement + upscaling

Usage:
    python main.py
    
Server runs on http://localhost:8000
"""

import os
import io
import base64
import logging
from typing import Optional
from contextlib import asynccontextmanager

import cv2
import numpy as np
from PIL import Image
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Global model instances
realesrgan_model = None
gfpgan_model = None


class EnhanceRequest(BaseModel):
    image: str  # Base64 encoded image
    scale: Optional[int] = 2  # 1, 2, 3, or 4
    enhance_face: Optional[bool] = False
    denoise_strength: Optional[float] = 0.5


class EnhanceResponse(BaseModel):
    image: str  # Base64 encoded result
    width: int
    height: int
    message: str


def load_models():
    """Load AI models on startup"""
    global realesrgan_model, gfpgan_model
    
    logger.info("Loading Real-ESRGAN model...")
    try:
        from realesrgan import RealESRGANer
        from basicsr.archs.rrdbnet_arch import RRDBNet
        
        # Use RealESRGAN-x4plus model for general images
        model = RRDBNet(num_in_ch=3, num_out_ch=3, num_feat=64, 
                       num_block=23, num_grow_ch=32, scale=4)
        
        model_path = os.path.join(os.path.dirname(__file__), 
                                  'weights', 'RealESRGAN_x4plus.pth')
        
        # Download model if not exists
        if not os.path.exists(model_path):
            os.makedirs(os.path.dirname(model_path), exist_ok=True)
            logger.info("Downloading RealESRGAN model...")
            import urllib.request
            url = 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth'
            urllib.request.urlretrieve(url, model_path)
            logger.info("Model downloaded successfully")
        
        realesrgan_model = RealESRGANer(
            scale=4,
            model_path=model_path,
            model=model,
            tile=0,  # No tiling for speed, use tile=400 for large images
            tile_pad=10,
            pre_pad=0,
            half=True  # Use FP16 for faster inference
        )
        logger.info("✓ Real-ESRGAN loaded successfully")
        
    except Exception as e:
        logger.error(f"Failed to load Real-ESRGAN: {e}")
        realesrgan_model = None
    
    logger.info("Loading GFPGAN model...")
    try:
        from gfpgan import GFPGANer
        
        model_path = os.path.join(os.path.dirname(__file__), 
                                  'weights', 'GFPGANv1.4.pth')
        
        # Download model if not exists
        if not os.path.exists(model_path):
            os.makedirs(os.path.dirname(model_path), exist_ok=True)
            logger.info("Downloading GFPGAN model...")
            import urllib.request
            url = 'https://github.com/TencentARC/GFPGAN/releases/download/v1.3.0/GFPGANv1.4.pth'
            urllib.request.urlretrieve(url, model_path)
            logger.info("Model downloaded successfully")
        
        gfpgan_model = GFPGANer(
            model_path=model_path,
            upscale=4,
            arch='clean',
            channel_multiplier=2,
            bg_upsampler=realesrgan_model
        )
        logger.info("✓ GFPGAN loaded successfully")
        
    except Exception as e:
        logger.error(f"Failed to load GFPGAN: {e}")
        gfpgan_model = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan event handler for model loading"""
    load_models()
    yield
    # Cleanup
    logger.info("Shutting down...")


# Create FastAPI app
app = FastAPI(
    title="AI Image Enhancer",
    description="Image enhancement API with Real-ESRGAN and GFPGAN",
    version="1.0.0",
    lifespan=lifespan
)

# Enable CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for local development
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def decode_base64_image(base64_str: str) -> np.ndarray:
    """Decode base64 image to numpy array (BGR format for OpenCV)"""
    # Remove data URL prefix if present
    if ',' in base64_str:
        base64_str = base64_str.split(',')[1]
    
    img_data = base64.b64decode(base64_str)
    img = Image.open(io.BytesIO(img_data))
    img_array = np.array(img.convert('RGB'))
    return cv2.cvtColor(img_array, cv2.COLOR_RGB2BGR)


def encode_image_base64(img: np.ndarray) -> str:
    """Encode numpy array (BGR) to base64 PNG"""
    img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    pil_img = Image.fromarray(img_rgb)
    buffer = io.BytesIO()
    pil_img.save(buffer, format='PNG', optimize=True)
    return 'data:image/png;base64,' + base64.b64encode(buffer.getvalue()).decode()


@app.get("/")
async def root():
    """Health check endpoint"""
    return {
        "status": "running",
        "realesrgan": realesrgan_model is not None,
        "gfpgan": gfpgan_model is not None
    }


@app.get("/health")
async def health():
    """Health check for the server"""
    return {"status": "healthy"}


@app.post("/enhance", response_model=EnhanceResponse)
async def enhance_image(request: EnhanceRequest):
    """
    Enhance image quality (deblur, denoise, restore details)
    Works on all image types
    """
    if realesrgan_model is None:
        raise HTTPException(status_code=503, detail="Real-ESRGAN model not loaded")
    
    try:
        # Decode input image
        img = decode_base64_image(request.image)
        logger.info(f"Enhancing image: {img.shape}")
        
        # Enhance with Real-ESRGAN
        output, _ = realesrgan_model.enhance(img, outscale=request.scale)
        
        # Encode result
        result_base64 = encode_image_base64(output)
        
        return EnhanceResponse(
            image=result_base64,
            width=output.shape[1],
            height=output.shape[0],
            message="Enhancement successful"
        )
        
    except Exception as e:
        logger.error(f"Enhancement failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/upscale", response_model=EnhanceResponse)
async def upscale_image(request: EnhanceRequest):
    """
    Upscale image to higher resolution
    """
    if realesrgan_model is None:
        raise HTTPException(status_code=503, detail="Real-ESRGAN model not loaded")
    
    try:
        img = decode_base64_image(request.image)
        logger.info(f"Upscaling image: {img.shape} -> {request.scale}x")
        
        output, _ = realesrgan_model.enhance(img, outscale=request.scale)
        result_base64 = encode_image_base64(output)
        
        return EnhanceResponse(
            image=result_base64,
            width=output.shape[1],
            height=output.shape[0],
            message=f"Upscaled to {request.scale}x"
        )
        
    except Exception as e:
        logger.error(f"Upscale failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/enhance-face", response_model=EnhanceResponse)
async def enhance_face(request: EnhanceRequest):
    """
    Enhance faces in image using GFPGAN
    Best for portraits and photos with people
    """
    if gfpgan_model is None:
        raise HTTPException(status_code=503, detail="GFPGAN model not loaded")
    
    try:
        img = decode_base64_image(request.image)
        logger.info(f"Enhancing faces in image: {img.shape}")
        
        # GFPGAN enhancement
        _, _, output = gfpgan_model.enhance(
            img,
            has_aligned=False,
            only_center_face=False,
            paste_back=True
        )
        
        result_base64 = encode_image_base64(output)
        
        return EnhanceResponse(
            image=result_base64,
            width=output.shape[1],
            height=output.shape[0],
            message="Face enhancement successful"
        )
        
    except Exception as e:
        logger.error(f"Face enhancement failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/process", response_model=EnhanceResponse)
async def process_image(request: EnhanceRequest):
    """
    Full processing pipeline:
    1. Face enhancement with GFPGAN (if enabled)
    2. General enhancement with Real-ESRGAN
    3. Upscaling to target scale
    """
    try:
        img = decode_base64_image(request.image)
        logger.info(f"Processing image: {img.shape}, scale={request.scale}, face={request.enhance_face}")
        
        output = img
        
        # Step 1: Face enhancement (optional)
        if request.enhance_face and gfpgan_model is not None:
            logger.info("Applying face enhancement...")
            _, _, output = gfpgan_model.enhance(
                output,
                has_aligned=False,
                only_center_face=False,
                paste_back=True
            )
        
        # Step 2: General enhancement + upscale with Real-ESRGAN
        if realesrgan_model is not None:
            logger.info(f"Applying Real-ESRGAN enhancement ({request.scale}x)...")
            output, _ = realesrgan_model.enhance(output, outscale=request.scale)
        
        result_base64 = encode_image_base64(output)
        
        return EnhanceResponse(
            image=result_base64,
            width=output.shape[1],
            height=output.shape[0],
            message="Processing complete"
        )
        
    except Exception as e:
        logger.error(f"Processing failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
