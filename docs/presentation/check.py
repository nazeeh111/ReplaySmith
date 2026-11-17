"""Standard-library integrity reader. Does not claim to rerun the browser."""
import hashlib,json
from pathlib import Path
p=Path(__file__).parent
m=json.loads((p/'MANIFEST.json').read_text())
for name,digest in m['sha256'].items():
 assert (p/name).is_file(),name
 assert hashlib.sha256((p/name).read_bytes()).hexdigest()==digest,name
print(f"Verified {len(m['sha256'])} exact payloads; browser replay is separate: node replay.mjs")
