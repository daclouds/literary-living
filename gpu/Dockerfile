FROM python:3.12-slim AS protocol-test
WORKDIR /worker
RUN pip install --no-cache-dir requests==2.32.5
COPY worker.py test_worker.py ./
RUN python -m unittest discover -s . -p 'test_*.py'

# Optional prebuilt image. The default Nosana job also works without publishing this image.
FROM pytorch/pytorch@sha256:77f17f843507062875ce8be2a6f76aa6aa3df7f9ef1e31d9d7432f4b0f563dee
WORKDIR /worker
COPY requirements.txt .
RUN python -m pip install --no-cache-dir --requirement requirements.txt
COPY worker.py .
ENV PYTHONUNBUFFERED=1 HF_HUB_DISABLE_TELEMETRY=1
ENTRYPOINT ["python", "/worker/worker.py"]
