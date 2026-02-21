#this will serve as the metadata schema for building the vector database
#ensure that you set the booleans based on what the client wants.
#this is a template and can be modified based on the client's needs.

#lectures for colleges
LECTURES = False
#RBAC for institutions
RBAC = True

REQUIRED_METADATA = {
    "base": {
        "document_id",
        "chunk_id",
        "text",
    },
    "lectures": {"class_id"},
    "rbac": {"role_id"}, #add more stuff here as needed
}

def get_required_metadata() -> set[str]:
    required = set(REQUIRED_METADATA["base"])

    #add more If statements here as needed.
    if LECTURES:
        required |= REQUIRED_METADATA["lectures"]

    if RBAC:
        required |= REQUIRED_METADATA["rbac"]

    return required


def validate_metadata(metadata: dict):
    required = get_required_metadata()
    missing = required - metadata.keys()

    if missing:
        raise ValueError(f"Missing required metadata: {missing}")