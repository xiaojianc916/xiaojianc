#[path = "../wsl_link/mod.rs"]
mod wsl_link;

#[cfg(target_os = "linux")]
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    use wsl_link::{
        adapters::linux_vsock::{VsockListener, VMADDR_CID_ANY},
        agent::WslLinkAgentService,
        config::WslLinkTransportConfig,
        protocol::v1::wsl_link_server::WslLinkServer,
    };

    let config = WslLinkTransportConfig::default();
    let listener = VsockListener::bind(VMADDR_CID_ANY, config.vsock_grpc_port)?;
    let incoming = listener.incoming();

    config
        .grpc_server_builder()
        .add_service(WslLinkServer::new(WslLinkAgentService::new()))
        .serve_with_incoming(incoming)
        .await?;

    Ok(())
}

#[cfg(not(target_os = "linux"))]
fn main() {
    eprintln!("wsl-link-agent 仅面向 Linux/WSL2 构建。");
    std::process::exit(2);
}
