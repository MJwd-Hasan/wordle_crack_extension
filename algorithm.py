import nltk
nltk.download('words')
from nltk.corpus import words

five_letter_words = sorted(set(
    w.lower() for w in words.words() if len(w) == 5 and w.isalpha()
))