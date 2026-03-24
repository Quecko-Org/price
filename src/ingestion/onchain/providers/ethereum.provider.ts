import { Injectable } from '@nestjs/common';
import { ethers } from 'ethers';

@Injectable()
export class EthereumProvider {

  private provider: ethers.WebSocketProvider;

  constructor() {
    this.provider = new ethers.WebSocketProvider(process.env.ETH_WS || "");
  }

  getProvider() {
    return this.provider;
  }

}