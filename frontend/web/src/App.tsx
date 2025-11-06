import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { JSX, useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface NFTData {
  id: number;
  name: string;
  encryptedRarity: string;
  publicValue1: number;
  publicValue2: number;
  timestamp: number;
  creator: string;
  isVerified?: boolean;
  decryptedValue?: number;
}

interface RarityStats {
  common: number;
  rare: number;
  epic: number;
  legendary: number;
  total: number;
}

interface FAQItem {
  question: string;
  answer: string;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [nfts, setNfts] = useState<NFTData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingNFT, setCreatingNFT] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending" as const, 
    message: "" 
  });
  const [newNFTData, setNewNFTData] = useState({ name: "", rarity: "" });
  const [selectedNFT, setSelectedNFT] = useState<NFTData | null>(null);
  const [decryptedData, setDecryptedData] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [activeTab, setActiveTab] = useState("nfts");
  const [searchTerm, setSearchTerm] = useState("");

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting} = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  const faqItems: FAQItem[] = [
    {
      question: "什么是FHE同态加密？",
      answer: "全同态加密允许在加密数据上直接进行计算，无需解密即可处理数据，确保NFT属性在开图前完全保密。"
    },
    {
      question: "如何保证开图的公平性？",
      answer: "所有属性种子在链上加密存储，开图时通过同态计算验证结果，防止提前泄露和科学家狙击。"
    },
    {
      question: "加密过程如何工作？",
      answer: "使用Zama FHE技术对NFT属性进行加密，只有开图时才能通过离线解密和链上验证获取真实属性。"
    },
    {
      question: "支持哪些数据类型？",
      answer: "目前仅支持整型数字的加密计算，包括稀有度分数、属性值等数值型数据。"
    }
  ];

  const rarityStats: RarityStats = {
    common: nfts.filter(n => n.decryptedValue && n.decryptedValue < 30).length,
    rare: nfts.filter(n => n.decryptedValue && n.decryptedValue >= 30 && n.decryptedValue < 70).length,
    epic: nfts.filter(n => n.decryptedValue && n.decryptedValue >= 70 && n.decryptedValue < 90).length,
    legendary: nfts.filter(n => n.decryptedValue && n.decryptedValue >= 90).length,
    total: nfts.length
  };

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM初始化失败" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const nftsList: NFTData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          nftsList.push({
            id: parseInt(businessId.replace('nft-', '')) || Date.now(),
            name: businessData.name,
            encryptedRarity: businessId,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading NFT data:', e);
        }
      }
      
      setNfts(nftsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "加载数据失败" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createNFT = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "请先连接钱包" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingNFT(true);
    setTransactionStatus({ visible: true, status: "pending", message: "使用Zama FHE创建加密NFT..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("获取合约失败");
      
      const rarityValue = parseInt(newNFTData.rarity) || 0;
      const businessId = `nft-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, rarityValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newNFTData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        0,
        0,
        "加密NFT稀有度"
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "等待交易确认..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "NFT创建成功!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewNFTData({ name: "", rarity: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "用户取消交易" 
        : "提交失败: " + (e.message || "未知错误");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingNFT(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "请先连接钱包" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "数据已在链上验证" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "链上验证解密中..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "数据解密验证成功!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "数据已在链上验证" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        await loadData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "解密失败: " + (e.message || "未知错误") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const callIsAvailable = async () => {
    try {
      const contract = await getContractWithSigner();
      if (!contract) return;
      
      const tx = await contract.isAvailable();
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "isAvailable调用成功!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "调用失败" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredNFTs = nfts.filter(nft => 
    nft.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    nft.creator.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const renderRarityChart = () => {
    return (
      <div className="rarity-chart">
        <div className="chart-row">
          <div className="chart-label">普通 ({rarityStats.common})</div>
          <div className="chart-bar">
            <div 
              className="bar-fill common" 
              style={{ width: `${(rarityStats.common / rarityStats.total) * 100}%` }}
            >
              <span className="bar-value">{rarityStats.common}</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">稀有 ({rarityStats.rare})</div>
          <div className="chart-bar">
            <div 
              className="bar-fill rare" 
              style={{ width: `${(rarityStats.rare / rarityStats.total) * 100}%` }}
            >
              <span className="bar-value">{rarityStats.rare}</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">史诗 ({rarityStats.epic})</div>
          <div className="chart-bar">
            <div 
              className="bar-fill epic" 
              style={{ width: `${(rarityStats.epic / rarityStats.total) * 100}%` }}
            >
              <span className="bar-value">{rarityStats.epic}</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">传说 ({rarityStats.legendary})</div>
          <div className="chart-bar">
            <div 
              className="bar-fill legendary" 
              style={{ width: `${(rarityStats.legendary / rarityStats.total) * 100}%` }}
            >
              <span className="bar-value">{rarityStats.legendary}</span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderStatsPanel = () => {
    return (
      <div className="stats-panels">
        <div className="panel metal-panel">
          <h3>总NFT数量</h3>
          <div className="stat-value">{rarityStats.total}</div>
          <div className="stat-trend">FHE加密保护</div>
        </div>
        
        <div className="panel metal-panel">
          <h3>已验证数据</h3>
          <div className="stat-value">{nfts.filter(n => n.isVerified).length}/{rarityStats.total}</div>
          <div className="stat-trend">链上验证</div>
        </div>
        
        <div className="panel metal-panel">
          <h3>平均稀有度</h3>
          <div className="stat-value">
            {nfts.length > 0 ? (nfts.reduce((sum, n) => sum + (n.decryptedValue || 0), 0) / nfts.length).toFixed(1) : 0}/100
          </div>
          <div className="stat-trend">同态计算</div>
        </div>
      </div>
    );
  };

  const renderFHEFlow = () => {
    return (
      <div className="fhe-flow">
        <div className="flow-step">
          <div className="step-icon">1</div>
          <div className="step-content">
            <h4>属性加密</h4>
            <p>NFT稀有度使用Zama FHE加密存储 🔐</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className="step-icon">2</div>
          <div className="step-content">
            <h4>链上存储</h4>
            <p>加密数据安全存储在区块链上</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className="step-icon">3</div>
          <div className="step-content">
            <h4>同态计算</h4>
            <p>开图时进行离线同态解密计算</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className="step-icon">4</div>
          <div className="step-content">
            <h4>链上验证</h4>
            <p>通过FHE.checkSignatures验证结果</p>
          </div>
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>NFT隐私开图 🔐</h1>
          </div>
          <div className="header-actions">
            <div className="wallet-connect-wrapper">
              <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
            </div>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔐</div>
            <h2>连接钱包开始使用</h2>
            <p>连接您的钱包来初始化加密开图系统，体验FHE保护的NFT稀有度揭示。</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>点击上方按钮连接钱包</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>FHE系统将自动初始化</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>开始创建和揭示加密NFT</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>初始化FHE加密系统...</p>
        <p>状态: {fhevmInitializing ? "初始化FHEVM" : status}</p>
        <p className="loading-note">这可能需要一些时间</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>加载加密开图系统...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>NFT隐私开图 🔐</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn"
          >
            + 创建加密NFT
          </button>
          <button 
            onClick={callIsAvailable} 
            className="test-btn"
          >
            测试连接
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>
      
      <nav className="app-nav">
        <button 
          className={`nav-btn ${activeTab === "nfts" ? "active" : ""}`}
          onClick={() => setActiveTab("nfts")}
        >
          NFT列表
        </button>
        <button 
          className={`nav-btn ${activeTab === "stats" ? "active" : ""}`}
          onClick={() => setActiveTab("stats")}
        >
          数据统计
        </button>
        <button 
          className={`nav-btn ${activeTab === "faq" ? "active" : ""}`}
          onClick={() => setActiveTab("faq")}
        >
          常见问题
        </button>
      </nav>
      
      <div className="main-content-container">
        {activeTab === "nfts" && (
          <div className="nfts-section">
            <div className="section-header">
              <h2>加密NFT收藏</h2>
              <div className="header-actions">
                <input 
                  type="text" 
                  placeholder="搜索NFT名称或创建者..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="search-input"
                />
                <button 
                  onClick={loadData} 
                  className="refresh-btn" 
                  disabled={isRefreshing}
                >
                  {isRefreshing ? "刷新中..." : "刷新"}
                </button>
              </div>
            </div>
            
            <div className="nfts-grid">
              {filteredNFTs.length === 0 ? (
                <div className="no-nfts">
                  <p>未找到NFT</p>
                  <button 
                    className="create-btn" 
                    onClick={() => setShowCreateModal(true)}
                  >
                    创建第一个NFT
                  </button>
                </div>
              ) : filteredNFTs.map((nft, index) => (
                <div 
                  className={`nft-card ${selectedNFT?.id === nft.id ? "selected" : ""} ${nft.isVerified ? "verified" : ""}`} 
                  key={index}
                  onClick={() => setSelectedNFT(nft)}
                >
                  <div className="nft-image">
                    <div className="nft-placeholder">
                      {nft.isVerified ? "🎁" : "❓"}
                    </div>
                  </div>
                  <div className="nft-info">
                    <div className="nft-name">{nft.name}</div>
                    <div className="nft-meta">
                      <span>创建者: {nft.creator.substring(0, 6)}...{nft.creator.substring(38)}</span>
                      <span>日期: {new Date(nft.timestamp * 1000).toLocaleDateString()}</span>
                    </div>
                    <div className="nft-status">
                      状态: {nft.isVerified ? 
                        `✅ 已验证 (稀有度: ${nft.decryptedValue})` : 
                        "🔒 等待开图"}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        {activeTab === "stats" && (
          <div className="stats-section">
            <h2>稀有度统计</h2>
            {renderStatsPanel()}
            
            <div className="panel metal-panel full-width">
              <h3>稀有度分布</h3>
              {renderRarityChart()}
            </div>
            
            <div className="panel metal-panel full-width">
              <h3>FHE 🔐 隐私开图流程</h3>
              {renderFHEFlow()}
            </div>
          </div>
        )}
        
        {activeTab === "faq" && (
          <div className="faq-section">
            <h2>常见问题解答</h2>
            <div className="faq-list">
              {faqItems.map((faq, index) => (
                <div className="faq-item" key={index}>
                  <div className="faq-question">
                    <span>Q: {faq.question}</span>
                  </div>
                  <div className="faq-answer">
                    <span>A: {faq.answer}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      
      {showCreateModal && (
        <ModalCreateNFT 
          onSubmit={createNFT} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingNFT} 
          nftData={newNFTData} 
          setNftData={setNewNFTData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedNFT && (
        <NFTDetailModal 
          nft={selectedNFT} 
          onClose={() => { 
            setSelectedNFT(null); 
            setDecryptedData(null); 
          }} 
          decryptedData={decryptedData} 
          setDecryptedData={setDecryptedData} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptData(selectedNFT.encryptedRarity)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalCreateNFT: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  nftData: any;
  setNftData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, nftData, setNftData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (name === 'rarity') {
      const intValue = value.replace(/[^\d]/g, '');
      setNftData({ ...nftData, [name]: intValue });
    } else {
      setNftData({ ...nftData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-nft-modal">
        <div className="modal-header">
          <h2>创建加密NFT</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 加密保护</strong>
            <p>稀有度数值将使用Zama FHE进行加密存储（仅支持整数）</p>
          </div>
          
          <div className="form-group">
            <label>NFT名称 *</label>
            <input 
              type="text" 
              name="name" 
              value={nftData.name} 
              onChange={handleChange} 
              placeholder="输入NFT名称..." 
            />
          </div>
          
          <div className="form-group">
            <label>稀有度数值 (0-100整数) *</label>
            <input 
              type="number" 
              name="rarity" 
              value={nftData.rarity} 
              onChange={handleChange} 
              placeholder="输入稀有度数值..." 
              step="1"
              min="0"
              max="100"
            />
            <div className="data-type-label">FHE加密整数</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">取消</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !nftData.name || !nftData.rarity} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "加密并创建中..." : "创建NFT"}
          </button>
        </div>
      </div>
    </div>
  );
};

const NFTDetailModal: React.FC<{
  nft: NFTData;
  onClose: () => void;
  decryptedData: number | null;
  setDecryptedData: (value: number | null) => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
}> = ({ nft, onClose, decryptedData, setDecryptedData, isDecrypting, decryptData }) => {
  const handleDecrypt = async () => {
    if (decryptedData !== null) { 
      setDecryptedData(null); 
      return; 
    }
    
    const decrypted = await decryptData();
    if (decrypted !== null) {
      setDecryptedData(decrypted);
    }
  };

  const getRarityLevel = (value: number) => {
    if (value < 30) return "普通";
    if (value < 70) return "稀有";
    if (value < 90) return "史诗";
    return "传说";
  };

  return (
    <div className="modal-overlay">
      <div className="nft-detail-modal">
        <div className="modal-header">
          <h2>NFT详情</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="nft-preview">
            <div className="nft-image-large">
              <div className="nft-placeholder-large">
                {nft.isVerified || decryptedData !== null ? "🎁" : "❓"}
              </div>
            </div>
            <div className="nft-info-detailed">
              <div className="info-item">
                <span>名称:</span>
                <strong>{nft.name}</strong>
              </div>
              <div className="info-item">
                <span>创建者:</span>
                <strong>{nft.creator.substring(0, 6)}...{nft.creator.substring(38)}</strong>
              </div>
              <div className="info-item">
                <span>创建时间:</span>
                <strong>{new Date(nft.timestamp * 1000).toLocaleDateString()}</strong>
              </div>
            </div>
          </div>
          
          <div className="data-section">
            <h3>加密稀有度数据</h3>
            
            <div className="data-row">
              <div className="data-label">稀有度数值:</div>
              <div className="data-value">
                {nft.isVerified && nft.decryptedValue ? 
                  `${nft.decryptedValue} (${getRarityLevel(nft.decryptedValue)}) - 链上已验证` : 
                  decryptedData !== null ? 
                  `${decryptedData} (${getRarityLevel(decryptedData)}) - 本地解密` : 
                  "🔒 FHE加密整数"
                }
              </div>
              <button 
                className={`decrypt-btn ${(nft.isVerified || decryptedData !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? (
                  "🔓 验证中..."
                ) : nft.isVerified ? (
                  "✅ 已验证"
                ) : decryptedData !== null ? (
                  "🔄 重新验证"
                ) : (
                  "🔓 验证解密"
                )}
              </button>
            </div>
            
            <div className="fhe-info">
              <div className="fhe-icon">🔐</div>
              <div>
                <strong>FHE 🔐 隐私开图</strong>
                <p>数据在链上加密存储。点击"验证解密"进行离线解密和链上验证。</p>
              </div>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">关闭</button>
          {!nft.isVerified && (
            <button 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
              className="verify-btn"
            >
              {isDecrypting ? "链上验证中..." : "链上验证"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;

