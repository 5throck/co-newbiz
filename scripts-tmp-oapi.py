# rebuild docs/openapi.yaml paths section: parse -> merge deleted-route removal + new routes -> dump
import io, json, re

yaml = __import__("js-yaml") if False else None
import js_yaml_stub  # noqa
