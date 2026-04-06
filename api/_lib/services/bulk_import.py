import io
import re
import pandas as pd
from api._lib.database import supabase

COLUMN_MAP = {
    "nombre": "name",
    "name": "name",
    "email": "email",
    "país": "country",
    "pais": "country",
    "country": "country",
    "teléfono": "phone",
    "telefono": "phone",
    "phone": "phone",
    "pasaporte": "passport",
    "passport": "passport",
    "rol": "role",
    "role": "role",
}

EMAIL_REGEX = re.compile(r"^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$")


def process_bulk_import(file_bytes: bytes, filename: str) -> dict:
    ext = filename.rsplit(".", 1)[-1].lower()
    if ext == "csv":
        df = pd.read_csv(io.BytesIO(file_bytes))
    elif ext in ("xlsx", "xls"):
        df = pd.read_excel(io.BytesIO(file_bytes))
    else:
        return {
            "total": 0, "imported": 0, "skipped": 0,
            "errors": [{"row": 0, "email": "", "reason": f"Unsupported file type: .{ext}"}],
        }

    df.columns = [str(c).strip().lower() for c in df.columns]
    rename = {}
    for col in df.columns:
        if col in COLUMN_MAP:
            rename[col] = COLUMN_MAP[col]
    df = df.rename(columns=rename)

    for req in ["name", "email", "role"]:
        if req not in df.columns:
            return {
                "total": len(df), "imported": 0, "skipped": 0,
                "errors": [{"row": 0, "email": "", "reason": f"Missing required column: {req}"}],
            }

    existing = supabase.table("personnel").select("email").execute()
    existing_emails = {r["email"].lower() for r in existing.data}

    errors = []
    valid_rows = []
    skipped = 0

    for idx, row in df.iterrows():
        row_num = idx + 2
        name = str(row.get("name", "")).strip()
        email = str(row.get("email", "")).strip()
        role = str(row.get("role", "")).strip().upper()

        if not name or name == "nan":
            errors.append({"row": row_num, "email": email, "reason": "Name is required"})
            continue
        if not email or email == "nan":
            errors.append({"row": row_num, "email": email, "reason": "Email is required"})
            continue
        if not EMAIL_REGEX.match(email):
            errors.append({"row": row_num, "email": email, "reason": "Invalid email format"})
            continue
        if role not in ("VGO", "TD"):
            errors.append({"row": row_num, "email": email, "reason": f"Role must be VGO or TD, got '{role}'"})
            continue
        if email.lower() in existing_emails:
            skipped += 1
            continue

        existing_emails.add(email.lower())
        record = {
            "name": name,
            "email": email,
            "role": role,
            "country": _clean(row.get("country")),
            "phone": _clean(row.get("phone")),
            "passport": _clean(row.get("passport")),
        }
        valid_rows.append(record)

    imported = 0
    if valid_rows:
        result = supabase.table("personnel").insert(valid_rows).execute()
        imported = len(result.data)

    return {
        "total": len(df),
        "imported": imported,
        "skipped": skipped,
        "errors": errors,
    }


def _clean(val) -> str | None:
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return None
    s = str(val).strip()
    return s if s and s != "nan" else None
