"""Intent classifier for the Dorm Assistant. Trains in a second or two from intents.json at start-up."""
import json
import random
import re
from pathlib import Path

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import FeatureUnion, Pipeline

DATA_FILE = Path(__file__).parent / "intents.json"
CONFIDENCE_THRESHOLD = 0.30  # below this the bot asks the user to rephrase
LIVE_TAGS = {"live_vacant", "live_overdue", "live_occupancy"}


def clean(text: str) -> str:
    text = str(text).lower().strip()
    text = re.sub(r"[^a-z0-9\s']", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def load_dataset():
    with open(DATA_FILE, encoding="utf-8") as f:
        data = json.load(f)
    texts, labels = [], []
    for intent in data["intents"]:
        for pattern in intent["patterns"]:
            texts.append(clean(pattern))
            labels.append(intent["tag"])
    return data, texts, labels


def build_pipeline() -> Pipeline:
    features = FeatureUnion([
        ("words", TfidfVectorizer(ngram_range=(1, 2), sublinear_tf=True)),
        ("chars", TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 4), sublinear_tf=True)),
    ])
    return Pipeline([("features", features), ("clf", LogisticRegression(C=30, max_iter=3000))])


class Brain:
    def __init__(self):
        data, texts, labels = load_dataset()
        self.model = build_pipeline().fit(texts, labels)
        self.responses = {i["tag"]: i["responses"] for i in data["intents"]}
        self.fallback = data["fallback_responses"]

    def predict(self, message: str):
        text = clean(message)
        if not text:
            return None, 0.0
        probs = self.model.predict_proba([text])[0]
        best = int(probs.argmax())
        return str(self.model.classes_[best]), float(probs[best])

    def answer(self, message: str):
        """Return (tag, confidence, text). tag is 'unknown' when not confident."""
        tag, conf = self.predict(message)
        if tag is None or conf < CONFIDENCE_THRESHOLD:
            return "unknown", conf, random.choice(self.fallback)
        return tag, conf, random.choice(self.responses[tag])
