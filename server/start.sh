#!/bin/bash

# AI Image Enhancer Server Startup Script
# This script sets up and runs the AI enhancement server

echo "🚀 AI Image Enhancer Server"
echo "================================"

# Check if Python is installed
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 is not installed. Please install Python 3.8+"
    exit 1
fi

# Navigate to server directory
cd "$(dirname "$0")"

# Create virtual environment if it doesn't exist
if [ ! -d "venv" ]; then
    echo "📦 Creating virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment
source venv/bin/activate

# Install dependencies
echo "📦 Installing dependencies..."
pip install --upgrade pip
pip install -r requirements.txt

# Create weights directory
mkdir -p weights

echo ""
echo "================================"
echo "🎯 Starting server on http://localhost:8000"
echo "📖 API docs at http://localhost:8000/docs"
echo "================================"
echo ""

# Run the server
python main.py
