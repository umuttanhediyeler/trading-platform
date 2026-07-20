FROM python:3.11-slim

WORKDIR /service

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir poetry==1.8.3 \
    && poetry config virtualenvs.create false

COPY pyproject.toml ./
RUN poetry install --no-root --only main --no-interaction

COPY app ./app

# Koyeb/Render inject PORT; default keeps local docker runs working.
ENV PORT=8002
EXPOSE 8002

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8002}"]
