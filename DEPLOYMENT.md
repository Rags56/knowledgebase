# Production Deployment Guide

We have streamlined the deployment process with an automated setup script.

## Prerequisites

-   Python 3 installed.
-   Docker and Docker Compose installed.
-   Access to an Ollama instance (running locally or remotely).

## Steps

1.  **Run the Setup Script:**
    Execute the following command in the project root:
    ```bash
    python3 setup_production.py
    ```

2.  **Configure Your Deployment:**
    The script will interactively ask for:
    -   **Configuration Name**: This will be the name of the folder created (e.g., `my_company`).
    -   **Database Credentials**: Username and password for the PostgreSQL database.
    -   **API Key**: A secret key for securing your API.
    -   **Extensions**: Which extensions to enable (default: `lectures`).

3.  **Deploy:**
    The script will create a folder with your specific configuration.
    ```bash
    cd <configuration_name>
    docker-compose up --build -d
    ```

## What gets created?

Inside your configuration folder (e.g., `my_company/`), you will find:
-   `docker-compose.yml`: Orchestration file for all services.
-   `.env`: Environment variables file with your secrets.
-   `backend/Dockerfile`: Custom build for the backend service.
-   `frontend/Dockerfile`: Custom build for the frontend service.
-   `postgres/Dockerfile`: Database container definition.
-   `qdrant/Dockerfile`: Vector database container definition.

## Customization

You can edit the `.env` file in the generated folder to change configurations post-generation.
To update code, just re-run `docker-compose up --build -d` inside the folder.
