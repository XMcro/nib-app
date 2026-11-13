#!/bin/sh
# Test-only certificate chain shaped like Apple's: a P-384 root, a P-384
# intermediate carrying Apple's WWDR marker, and a P-256 leaf carrying the App
# Store marker, all signed with SHA-384. Also two intermediates that must be
# refused, each with a leaf of its own (same leaf key): one whose WWDR marker
# is only bytes inside another extension's value, and one that is not a CA.
# Regenerate with: sh make-chain.sh
set -e
cd "$(dirname "$0")"
T=$(mktemp -d)
cat > "$T/ext.cnf" <<CNF
[req]
distinguished_name = dn
[dn]
[root]
basicConstraints = critical, CA:true
keyUsage = critical, keyCertSign, cRLSign
[intermediate]
basicConstraints = critical, CA:true, pathlen:0
keyUsage = critical, keyCertSign, cRLSign
1.2.840.113635.100.6.2.1 = ASN1:NULL
[hidden]
basicConstraints = critical, CA:true, pathlen:0
keyUsage = critical, keyCertSign, cRLSign
1.2.3.4 = DER:060a2a864886f76364060201
[notca]
basicConstraints = critical, CA:false
keyUsage = critical, keyCertSign, cRLSign
1.2.840.113635.100.6.2.1 = ASN1:NULL
[leaf]
basicConstraints = critical, CA:false
keyUsage = critical, digitalSignature
1.2.840.113635.100.6.11.1 = ASN1:NULL
CNF
openssl ecparam -name secp384r1 -genkey -noout -out "$T/root.key"
openssl ecparam -name secp384r1 -genkey -noout -out "$T/int.key"
openssl ecparam -name prime256v1 -genkey -noout -out "$T/leaf.key"
openssl req -new -x509 -sha384 -key "$T/root.key" -subj "/CN=Test Root" -days 7300 -config "$T/ext.cnf" -extensions root -out "$T/root.pem"
openssl req -new -key "$T/int.key" -subj "/CN=Test Intermediate" -config "$T/ext.cnf" -out "$T/int.csr"
openssl x509 -req -sha384 -in "$T/int.csr" -CA "$T/root.pem" -CAkey "$T/root.key" -CAcreateserial -days 7300 -extfile "$T/ext.cnf" -extensions intermediate -out "$T/int.pem"
openssl req -new -key "$T/leaf.key" -subj "/CN=Test Leaf" -config "$T/ext.cnf" -out "$T/leaf.csr"
openssl x509 -req -sha384 -in "$T/leaf.csr" -CA "$T/int.pem" -CAkey "$T/int.key" -CAcreateserial -days 7300 -extfile "$T/ext.cnf" -extensions leaf -out "$T/leaf.pem"
for variant in hidden notca; do
  openssl ecparam -name secp384r1 -genkey -noout -out "$T/$variant.key"
  openssl req -new -key "$T/$variant.key" -subj "/CN=Test Intermediate $variant" -config "$T/ext.cnf" -out "$T/$variant.csr"
  openssl x509 -req -sha384 -in "$T/$variant.csr" -CA "$T/root.pem" -CAkey "$T/root.key" -CAcreateserial -days 7300 -extfile "$T/ext.cnf" -extensions "$variant" -out "$T/$variant.pem"
  openssl x509 -req -sha384 -in "$T/leaf.csr" -CA "$T/$variant.pem" -CAkey "$T/$variant.key" -CAcreateserial -days 7300 -extfile "$T/ext.cnf" -extensions leaf -out "$T/$variant-leaf.pem"
done
der() { openssl x509 -in "$1" -outform der | base64 | tr -d '\n'; }
pkcs8() { openssl pkcs8 -topk8 -nocrypt -in "$1" -outform der | base64 | tr -d '\n'; }
printf '{\n  "root": "%s",\n  "intermediate": "%s",\n  "leaf": "%s",\n  "leafKey": "%s",\n  "hidden": { "intermediate": "%s", "leaf": "%s" },\n  "notCa": { "intermediate": "%s", "leaf": "%s" }\n}\n' \
  "$(der "$T/root.pem")" "$(der "$T/int.pem")" "$(der "$T/leaf.pem")" "$(pkcs8 "$T/leaf.key")" \
  "$(der "$T/hidden.pem")" "$(der "$T/hidden-leaf.pem")" "$(der "$T/notca.pem")" "$(der "$T/notca-leaf.pem")" > chain.json
rm -rf "$T"
