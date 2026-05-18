#![cfg_attr(target_family = "wasm", no_std)]
mod enclave_contract;
pub use enclave_contract::*;
