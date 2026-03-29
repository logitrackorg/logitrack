# Logitrack — Arquitectura

## Descripción general

Logitrack es un monorepo con dos servicios independientes desplegados en AWS:

- **Frontend**: SPA en React, alojada en AWS Amplify
- **Backend**: API REST en Go + Gin, conectada a DB PostgreSQL

---

## Diagrama de infraestructura

```mermaid
graph TD
    User([Usuario / Browser])

    subgraph AWS["AWS"]
        Amplify["React SPA"]
        EC2["Go con Gin API"]
        RDS["PostgreSQL"]
    end


    User --> Amplify
    Amplify -->EC2
    EC2 --> RDS
```

---

## Componentes

### AWS Amplify — Frontend

- Aloja la SPA de React + Vite.
- **Deploy automático**: cada push a `main` en GitHub dispara un nuevo build.

### AWS CloudFront — Proxy HTTPS

- Se ubica delante del EC2 para terminar TLS.
- **Por qué existe**: Amplify sirve el frontend por HTTPS. Los browsers bloquean llamadas HTTP desde páginas HTTPS (mixed content). El EC2 no tiene dominio propio ni certificado SSL, por lo que CloudFront maneja TLS.

### EC2 — Backend

- Corre la API Go + Gin en el puerto 8080.

### RDS — Base de datos

- PostgreSQL 17.4.

---

## Flujo de un request

```mermaid
sequenceDiagram
    participant B as Browser
    participant A as Amplify (SPA)
    participant CF as CloudFront
    participant E as EC2 (Go API)
    participant DB as RDS PostgreSQL

    B->>A: Carga la SPA (HTTPS)
    A-->>B: HTML/JS/CSS

    B->>CF: Llamada a la API (HTTPS)
    CF->>E: Reenvía el request (HTTP :8080)
    E->>DB: Consulta / escritura (TCP :5432)
    DB-->>E: Resultado
    E-->>CF: Respuesta JSON
    CF-->>B: Respuesta JSON (HTTPS)
```

---
