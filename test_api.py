import requests

try:
    res = requests.post("http://localhost:8000/assistant/chat", json={
        "messages": [
            {"role": "user", "content": "What are the classes?"}
        ]
    })
    print("Status:", res.status_code)
    print("Response:", res.text)
except Exception as e:
    print("Error:", e)
