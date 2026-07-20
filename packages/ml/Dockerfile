FROM python:3.11-slim

WORKDIR /service

# libgomp1 is required by lightgbm at runtime.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 build-essential \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir poetry==1.8.3 \
    && poetry config virtualenvs.create false

COPY pyproject.toml ./
RUN poetry install --no-root --only main --no-interaction

COPY app ./app

EXPOSE 8001

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
