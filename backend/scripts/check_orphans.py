"""Run the dual-ORM orphan check against DATABASE_URL.

Usage: `cd backend && python scripts/check_orphans.py`
Exit: 0 clean, 1 true orphans present, 2 config/connection failure.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.orphans import main

if __name__ == "__main__":
    raise SystemExit(main())
