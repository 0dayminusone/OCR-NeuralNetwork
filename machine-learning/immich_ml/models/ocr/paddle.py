from typing import Any

import numpy as np
from numpy.typing import NDArray
from paddleocr import PaddleOCR
from PIL import Image

from immich_ml.models.base import InferenceModel
from immich_ml.models.transforms import decode_cv2
from immich_ml.schemas import OCROutput, ModelTask, ModelType


class PaddleOCRecognizer(InferenceModel):
    depends = []
    identity = (ModelType.OCR, ModelTask.OCR)

    def __init__(self, model_name: str, confidence_threshold: float = 0.9, **model_kwargs: Any) -> None:
        self.confidence_threshold = model_kwargs.pop("minScore", confidence_threshold)
        super().__init__(model_name, **model_kwargs)
        self._initialize_model()
        self.loaded = True

    def _initialize_model(self) -> None:
        """Initialize the PaddleOCR model with optimized settings."""
        try:
            self.model = PaddleOCR(
                use_doc_orientation_classify=False,
                use_doc_unwarping=False,
                use_textline_orientation=False
            )
        except Exception as e:
            print(f"Failed to initialize PaddleOCR: {e}")
            raise

    def _predict(self, image_data: NDArray[np.uint8] | bytes | Image.Image, **kwargs: Any) -> OCROutput:
        """Extract text from image using PaddleOCR."""
        processed_image = decode_cv2(image_data)
        ocr_results = self.model.predict(processed_image)
        
        # Filter results by confidence threshold
        filtered_results = []
        for result in ocr_results:
            text_list = result['rec_texts']
            score_list = result['rec_scores']
            
            for text_content, confidence_score in zip(text_list, score_list):
                if confidence_score >= self.confidence_threshold:
                    filtered_results.append((text_content, confidence_score))
        
        # Handle empty results
        if not filtered_results:
            return OCROutput(text="", confidence=0.0)
            
        # Combine results
        extracted_texts, confidence_scores = zip(*filtered_results)
        combined_text = "".join(extracted_texts)
        average_confidence = sum(confidence_scores) / len(confidence_scores)
        
        return OCROutput(text=combined_text, confidence=average_confidence)
