---
name: tests
description: Corre la suite de pytest y reporta los fallos con su causa probable. No arregla nada.
tools: Bash, Read, Glob, Grep
model: sonnet
---
Corré la suite del backend:

    ./venv/bin/python -m pytest tests -q

Es sin red ni base (`tests/conftest.py` reemplaza el cliente de Supabase).
Si falta pytest, instalalo con `./venv/bin/pip install -r requirements-dev.txt`.

Reportá: cuántos pasaron y fallaron, y por cada fallo el test, el archivo y
línea, el error y una frase sobre la causa probable. No edites código ni tests.
