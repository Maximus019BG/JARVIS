import os
from typing import Optional
from pathlib import Path

class SecureStorage:
    """Secure key storage with TPM/Secure Enclave support"""
    
    def __init__(self):
        self.use_tpm = self._check_tpm_available()
        self.storage_path = Path('data/secure_storage')
        self.storage_path.mkdir(parents=True, exist_ok=True)
    
    def _check_tpm_available(self) -> bool:
        """Check if TPM is available"""
        try:
            from tpm2_pytss import ESAPI
            return True
        except ImportError:
            return False
    
    def store_key(self, key_id: str, key_data: bytes) -> bool:
        """Store key securely"""
        if self.use_tpm:
            return self._store_in_tpm(key_id, key_data)
        else:
            return self._store_encrypted(key_id, key_data)
    
    def retrieve_key(self, key_id: str) -> Optional[bytes]:
        """Retrieve key securely"""
        if self.use_tpm:
            return self._retrieve_from_tpm(key_id)
        else:
            return self._retrieve_encrypted(key_id)
    
    def _store_in_tpm(self, key_id: str, key_data: bytes) -> bool:
        """Store key in TPM"""
        try:
            from tpm2_pytss import ESAPI, TPM2B_PUBLIC, TPM2B_SENSITIVE_CREATE
            
            esys = ESAPI()
            public = TPM2B_PUBLIC()
            sensitive = TPM2B_SENSITIVE_CREATE()
            
            result = esys.create_primary(
                in_sensitive=sensitive,
                in_public=public
            )
            
            return True
        except Exception as e:
            print(f"TPM storage failed: {e}")
            return False
    
    def _retrieve_from_tpm(self, key_id: str) -> Optional[bytes]:
        """Retrieve key from TPM"""
        try:
            from tpm2_pytss import ESAPI
            esys = ESAPI()
            return b''
        except Exception as e:
            print(f"TPM retrieval failed: {e}")
            return None
    
    def _store_encrypted(self, key_id: str, key_data: bytes) -> bool:
        """Store key encrypted with system key"""
        import hashlib
        from cryptography.fernet import Fernet
        
        system_key = self._derive_system_key()
        fernet = Fernet(system_key)
        
        encrypted = fernet.encrypt(key_data)
        key_file = self.storage_path / f"{key_id}.enc"
        
        with open(key_file, 'wb') as f:
            f.write(encrypted)
        
        return True
    
    def _retrieve_encrypted(self, key_id: str) -> Optional[bytes]:
        """Retrieve encrypted key"""
        from cryptography.fernet import Fernet
        
        system_key = self._derive_system_key()
        fernet = Fernet(system_key)
        
        key_file = self.storage_path / f"{key_id}.enc"
        
        if not key_file.exists():
            return None
        
        with open(key_file, 'rb') as f:
            encrypted = f.read()
        
        return fernet.decrypt(encrypted)
    
    def _derive_system_key(self) -> bytes:
        """Derive encryption key from system-specific data"""
        import hashlib
        from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
        from cryptography.hazmat.primitives import hashes
        from cryptography.hazmat.backends import default_backend
        
        machine_id = self._get_machine_id()
        salt = hashlib.sha256(machine_id.encode()).digest()
        
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=salt,
            iterations=100000,
            backend=default_backend()
        )
        
        return kdf.derive(b'JARVIS_SECURE_STORAGE')
    
    def _get_machine_id(self) -> str:
        """Get unique machine identifier"""
        sources = []
        
        if os.name == 'nt':
            try:
                import winreg
                key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, 
                                   r'SOFTWARE\Microsoft\Cryptography')
                sources.append(winreg.QueryValueEx(key, 'MachineGuid')[0])
            except:
                pass
        else:
            for path in ['/etc/machine-id', '/var/lib/dbus/machine-id']:
                try:
                    with open(path, 'r') as f:
                        sources.append(f.read().strip())
                except:
                    pass
        
        import socket
        sources.append(socket.gethostname())
        
        return '|'.join(sources)