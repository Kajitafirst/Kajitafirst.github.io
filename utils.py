import torch

def numpy_to_gpu(data):
    device = torch.device("cuda")
    return torch.from_numpy(data).to(device, dtype=torch.float32)
