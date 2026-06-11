FROM python:3.12-slim

WORKDIR /app

COPY pyproject.toml ./
COPY app ./app
COPY ingest ./ingest
COPY scripts ./scripts
COPY assets ./assets

RUN pip install --no-cache-dir .

# Bake the preprocessed network into the image: download the GTFS feed and
# build the CSA arrays for the next Tuesday (small chunks: builder RAM cap),
# then drop the 129 MB zip. Each deploy refreshes the data.
RUN python -m ingest.download_gtfs \
    && python -m ingest.build_network --gtfs data/gtfs/IDFM-gtfs.zip --chunksize 1000000 \
    && rm -rf data/gtfs

EXPOSE 8000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
