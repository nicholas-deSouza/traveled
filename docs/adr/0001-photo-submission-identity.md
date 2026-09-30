# Preserve photo submission identity across retries

Each deliberate photo submission has one stable identity reused by automatic and manual retries, so repeated attempts cannot create additional gallery entries. Identity is scoped to the submission rather than the image's contents: users may intentionally submit the same image again later or to another trip, trading content deduplication for that freedom.
